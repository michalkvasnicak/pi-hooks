import type { Check } from '../config.js';
import { CheckSnapshotService } from './check-snapshot.js';
import { RepositorySnapshotService } from './repository-snapshot.js';

export type CheckFailure = { check: Check; index: number; error: unknown };

export class RepositoryService {
  private readonly failedChecks = new Set<string>();

  constructor(
    readonly path: string,
    private readonly repositorySnapshots: RepositorySnapshotService,
    private readonly checkSnapshots: CheckSnapshotService,
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
    runCheck: (check: Check, index: number) => Promise<void>,
    failFast = true,
  ): Promise<CheckFailure[]> {
    if (checks.length === 0) return [];
    const snapshot = await this.repositorySnapshots.capture(this.path);
    const failures: CheckFailure[] = [];

    for (const [index, check] of checks.entries()) {
      const key = JSON.stringify(check);
      const changed = this.checkSnapshots.changed(check, snapshot);
      if (!changed && !this.failedChecks.has(key)) continue;

      try {
        await runCheck(check, index);
        this.failedChecks.delete(key);
      } catch (error) {
        this.failedChecks.add(key);
        failures.push({ check, index, error });
        if (failFast) break;
      }
    }

    return failures;
  }
}
