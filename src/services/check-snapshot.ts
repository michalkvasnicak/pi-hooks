import picomatch from 'picomatch';
import type { Check } from '../config.js';
import type { RepositorySnapshot } from './repository-snapshot.js';

export class CheckSnapshotService {
  private readonly snapshots = new Map<string, RepositorySnapshot>();

  reset(): void {
    this.snapshots.clear();
  }

  /** Compare matching files and advance the stored snapshot, even before a check runs. */
  changed(check: Check, snapshot: RepositorySnapshot): boolean {
    const key = JSON.stringify(check);
    const previous = this.snapshots.get(key);
    const patterns = check.inputs?.map((pattern) => picomatch(pattern));
    const files = snapshot === null ? null : Object.fromEntries(
      Object.entries(snapshot).filter(
        ([path]) => !patterns?.length || patterns.some((match) => match(path)),
      ),
    );
    this.snapshots.set(key, files);

    // Unknown state is always considered changed, including after capture recovers.
    return previous == null || files === null ||
      JSON.stringify(previous) !== JSON.stringify(files);
  }
}
