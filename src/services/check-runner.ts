import { spawn } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { Check } from '../config.js';

export type CheckContext = {
  cwd: string;
  event: { outcome: string; turnIndex?: number };
};

export class CheckExecutionError extends Error {
  constructor(message: string, readonly logPath: string) {
    super(message);
    this.name = 'CheckExecutionError';
  }
}

export class CheckRunnerService {
  async run(check: Check, ctx: CheckContext): Promise<void> {
    if (check.type === 'command') {
      await this.runCommand(check.command, ctx.cwd);
      return;
    }

    const scriptPath = resolve(ctx.cwd, check.path);
    const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
    const loaded = await jiti.import<{ default?: (context: CheckContext) => unknown }>(scriptPath);
    if (typeof loaded.default !== 'function') {
      throw new Error(`Script ${check.path} must have a default-exported function`);
    }
    const result = await loaded.default(ctx);
    if (typeof result === 'string' && result.length > 0) throw new Error(result);
  }

  private async runCommand(command: string, cwd: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'pi-hooks-'));
    const logPath = join(directory, 'check.log');
    const log = await open(logPath, 'a', 0o600);
    let succeeded = false;
    try {
      await log.writeFile(`Command: ${command}\n\n`);
      // Both streams go directly to disk: no output-size limit or in-memory buffer.
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, {
          cwd,
          shell: true,
          stdio: ['ignore', log.fd, log.fd],
        });
        child.once('error', reject);
        child.once('close', (code, signal) => {
          if (code === 0) resolve();
          else reject(new Error(signal ? `Command terminated by ${signal}` : `Command exited with code ${code}`));
        });
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await log.writeFile(`\n${message}\n`);
      throw new CheckExecutionError(message, logPath);
    } finally {
      await log.close();
      if (succeeded) await rm(directory, { recursive: true, force: true });
    }
  }
}
