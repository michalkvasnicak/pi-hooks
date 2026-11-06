import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type FileRecord = { mtimeMs: number; size: number; hash: string };
export type RepositorySnapshot = Readonly<Record<string, string>> | null;

export class RepositorySnapshotService {
  private readonly fileRecords = new Map<string, FileRecord>();

  reset(): void {
    this.fileRecords.clear();
  }

  async capture(cwd: string): Promise<RepositorySnapshot> {
    try {
      const listed = await this.git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
      const paths = [...new Set(listed.split('\0').filter(Boolean))].sort();
      const untracked = new Set(
        (await this.git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean),
      );
      const modified = new Set(
        (await this.git(cwd, ['ls-files', '--modified', '-z'])).split('\0').filter(Boolean),
      );
      const files: Record<string, string> = {};

      for (const path of paths) {
        const absolutePath = join(cwd, path);
        const stat = statSync(absolutePath, { throwIfNoEntry: false });
        if (!stat?.isFile()) continue;
        const previousFile = this.fileRecords.get(path);
        const needsHash = untracked.has(path) || modified.has(path) || !previousFile ||
          previousFile.mtimeMs !== stat.mtimeMs || previousFile.size !== stat.size;
        const hash = needsHash
          ? createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
          : previousFile.hash;
        this.fileRecords.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
        files[path] = hash;
      }

      return files;
    } catch {
      // An unavailable snapshot must never be mistaken for an empty repository.
      return null;
    }
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }
}
