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

export type InputSnapshot = { changed: boolean; commit: () => void };

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

/** Builds the current input snapshot; commit it only after the check succeeds. */
export async function snapshotInputs(check: Check, cwd: string): Promise<InputSnapshot> {
  if (!check.inputs?.length) return { changed: true, commit: () => {} };

  try {
    const cache = getRepoCache(cwd);
    const listed = await git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    const paths = listed
      .split('\0')
      .filter(Boolean)
      .filter((path) => check.inputs!.some((pattern) => picomatch(pattern)(path)));
    const untracked = new Set(
      (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean),
    );
    const modified = new Set(
      (await git(cwd, ['diff', '--name-only', 'HEAD', '--'])).split('\n').filter(Boolean),
    );
    const files: Record<string, string> = {};

    for (const path of paths) {
      const absolutePath = join(cwd, path);
      const stat = statSync(absolutePath);
      if (!stat.isFile()) continue;
      const previousFile = cache.fileRecords.get(path);
      const needsHash = untracked.has(path) || modified.has(path) || !previousFile ||
        previousFile.mtimeMs !== stat.mtimeMs || previousFile.size !== stat.size;
      const hash = needsHash ? hashFile(absolutePath) : previousFile.hash;
      cache.fileRecords.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
      files[path] = hash;
    }

    const signature = JSON.stringify(check);
    const previousCheck = cache.checks.get(signature);
    const changed = !previousCheck || JSON.stringify(previousCheck.files) !== JSON.stringify(files);
    return {
      changed,
      commit: () => cache.checks.set(signature, { signature, files }),
    };
  } catch {
    // If Git is unavailable, prefer running the check over skipping it.
    return { changed: true, commit: () => {} };
  }
}
