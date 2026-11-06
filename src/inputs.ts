import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import picomatch from 'picomatch';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Check } from './config.js';

const execFileAsync = promisify(execFile);

type FileRecord = { mtimeMs: number; size: number; hash: string };
type CheckRecord = { signature: string; files: Record<string, string> };
type RepoCache = { fileRecords: Map<string, FileRecord>; checks: Map<string, CheckRecord> };

const repoCaches = new Map<string, RepoCache>();

export type RepositorySnapshot = Readonly<Record<string, string>> | null;
export type InputSnapshot = { changed: boolean; commit: () => void };

/** Start each session with a fresh baseline, including any pre-existing edits. */
export function resetInputSnapshots(cwd: string): void {
  repoCaches.delete(resolve(cwd));
}

function getRepoCache(cwd: string): RepoCache {
  const key = resolve(cwd);
  let cache = repoCaches.get(key);
  if (!cache) {
    cache = { fileRecords: new Map(), checks: new Map() };
    repoCaches.set(key, cache);
  }
  return cache;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Scan and hash the repository once for all checks at a lifecycle boundary. */
export async function snapshotRepository(cwd: string): Promise<RepositorySnapshot> {
  try {
    const cache = getRepoCache(cwd);
    const listed = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    const paths = [...new Set(listed.split('\0').filter(Boolean))].sort();
    const untracked = new Set(
      (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean),
    );
    const modified = new Set(
      (await git(cwd, ['ls-files', '--modified', '-z'])).split('\0').filter(Boolean),
    );
    const files: Record<string, string> = {};

    for (const path of paths) {
      const absolutePath = join(cwd, path);
      const stat = statSync(absolutePath, { throwIfNoEntry: false });
      if (!stat?.isFile()) continue;
      const previousFile = cache.fileRecords.get(path);
      const needsHash = untracked.has(path) || modified.has(path) || !previousFile ||
        previousFile.mtimeMs !== stat.mtimeMs || previousFile.size !== stat.size;
      const hash = needsHash ? hashFile(absolutePath) : previousFile.hash;
      cache.fileRecords.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
      files[path] = hash;
    }

    return files;
  } catch {
    // An unavailable snapshot must never be mistaken for an empty repository.
    return null;
  }
}

/** Filter the shared snapshot; commit a check's baseline only after it succeeds. */
export function snapshotInputs(
  check: Check,
  cwd: string,
  repository: RepositorySnapshot,
): InputSnapshot {
  if (repository === null) return { changed: true, commit: () => {} };

  const patterns = check.inputs?.map((pattern) => picomatch(pattern));
  const files = Object.fromEntries(
    Object.entries(repository).filter(([path]) => !patterns?.length || patterns.some((match) => match(path))),
  );
  const cache = getRepoCache(cwd);
  const signature = JSON.stringify(check);
  const previousCheck = cache.checks.get(signature);
  const changed = !previousCheck || JSON.stringify(previousCheck.files) !== JSON.stringify(files);
  return {
    changed,
    commit: () => cache.checks.set(signature, { signature, files }),
  };
}
