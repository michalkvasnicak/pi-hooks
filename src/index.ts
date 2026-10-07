import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig, type Check } from './config.js';

const execFileAsync = promisify(execFile);

type CheckContext = {
  cwd: string;
  event: { outcome: string; turnIndex?: number };
};

async function runCheck(check: Check, ctx: CheckContext): Promise<void> {
  if (check.type === 'command') {
    await execFileAsync(check.command, {
      cwd: ctx.cwd,
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });
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

export default function (pi: ExtensionAPI): void {
  let checks: Check[] = [];
  let failFast = true;
  let maxRetries = 5;
  let retriesUsed = 0;

  pi.on('agent_start', () => {
    retriesUsed = 0;
  });

  pi.on('session_start', (_event, ctx) => {
    try {
      const config = loadConfig(ctx.cwd)?.agent_before_settle;
      checks = config?.checks ?? [];
      failFast = config?.failFast ?? true;
      maxRetries = config?.maxRetries ?? 5;
    } catch (error) {
      checks = [];
      failFast = true;
      maxRetries = 5;
      ctx.ui.notify(`pi-hooks: ${(error as Error).message}`, 'error');
    }
  });

  pi.on('agent_before_settle', async (event, ctx) => {
    const failures: string[] = [];
    for (const [index, check] of checks.entries()) {
      const name = check.name?.trim() || String(index + 1);
      ctx.ui.setStatus('pi-hooks', `Running: ${name}`);
      try {
        await runCheck(check, { cwd: ctx.cwd, event: { outcome: event.outcome } });
      } catch (error) {
        const detail = error as Error & { stdout?: string; stderr?: string };
        const output = [detail.message, detail.stdout, detail.stderr].filter(Boolean).join('\n');
        failures.push(`${name}: ${output}`);
        if (failFast) break;
      } finally {
        ctx.ui.setStatus('pi-hooks', undefined);
      }
    }

    if (failures.length === 0) return;
    const shouldContinue = retriesUsed < maxRetries;
    if (shouldContinue) retriesUsed++;
    return {
      entries: failures.map((failure) => ({
        type: 'custom_message' as const,
        customType: 'pi-hooks-check-failure',
        content: failure,
        display: true,
      })),
      continue: shouldContinue,
    };
  });
}
