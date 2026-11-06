import type { Check } from '../config.js';
import { CheckSnapshotService } from './check-snapshot.js';
import { CheckRunnerService, type CheckContext } from './check-runner.js';
import { RepositorySnapshotService } from './repository-snapshot.js';

export type CheckFailure = { check: Check; index: number; error: unknown };

export type CheckProgressEvent =
  | { type: 'started'; check: Check; index: number }
  | { type: 'skipped'; check: Check; index: number; reason: 'unchanged' }
  | { type: 'succeeded'; check: Check; index: number }
  | { type: 'failed'; check: Check; index: number; error: unknown };

export type CheckOptions = {
  event: CheckContext['event'];
  failFast?: boolean;
  onProgress?: (event: CheckProgressEvent) => void;
};

export class RepositoryService {
  private readonly failedChecks = new Set<string>();

  constructor(
    readonly path: string,
    private readonly repositorySnapshots: RepositorySnapshotService,
    private readonly checkSnapshots: CheckSnapshotService,
    private readonly runner: CheckRunnerService,
  ) {}

  /** Establish fresh baselines at the beginning of each session. */
  async snapshot(checks: Check[]): Promise<void> {
    this.repositorySnapshots.reset();
    this.checkSnapshots.reset();
    this.failedChecks.clear();
    if (checks.length === 0) return;

    const snapshot = await this.repositorySnapshots.capture(this.path);
    for (const check of checks) {
      this.checkSnapshots.changed(check, snapshot);
    }
  }

  async check(
    checks: Check[],
    { event, failFast = true, onProgress }: CheckOptions,
  ): Promise<CheckFailure[]> {
    if (checks.length === 0) return [];
    const snapshot = await this.repositorySnapshots.capture(this.path);
    const failures: CheckFailure[] = [];

    for (const [index, check] of checks.entries()) {
      const key = JSON.stringify(check);
      const changed = this.checkSnapshots.changed(check, snapshot);
      if (!changed && !this.failedChecks.has(key)) {
        onProgress?.({ type: 'skipped', check, index, reason: 'unchanged' });
        continue;
      }

      onProgress?.({ type: 'started', check, index });
      let failure: CheckFailure | undefined;
      try {
        await this.runner.run(check, { cwd: this.path, event });
        this.failedChecks.delete(key);
      } catch (error) {
        this.failedChecks.add(key);
        failure = { check, index, error };
        failures.push(failure);
      }

      // Observer errors are not classified as check execution failures.
      if (failure) {
        onProgress?.({ type: 'failed', ...failure });
        if (failFast) break;
      } else {
        onProgress?.({ type: 'succeeded', check, index });
      }
    }

    return failures;
  }
}
