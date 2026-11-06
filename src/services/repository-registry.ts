import { resolve } from 'node:path';
import { CheckSnapshotService } from './check-snapshot.js';
import { RepositoryService } from './repository.js';
import { RepositorySnapshotService } from './repository-snapshot.js';

export class RepositoryRegistryService {
  private readonly repositories = new Map<string, RepositoryService>();

  getOrCreate(path: string): RepositoryService {
    const key = resolve(path);
    let repository = this.repositories.get(key);
    if (!repository) {
      repository = new RepositoryService(
        key,
        new RepositorySnapshotService(),
        new CheckSnapshotService(),
      );
      this.repositories.set(key, repository);
    }
    return repository;
  }
}
