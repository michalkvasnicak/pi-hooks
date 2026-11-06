import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import picomatch from 'picomatch';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig, type Check, type ToolRule } from './config.js';
import { RepositoryRegistryService } from './services/repository-registry.js';

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

function matches(rule: ToolRule, toolName: string, input: Record<string, unknown>): boolean {
  if (!picomatch.isMatch(toolName, rule.match.tool)) return false;
  return Object.entries(rule.match.arguments ?? {}).every(
    ([key, pattern]) =>
      typeof input[key] === 'string' && picomatch.isMatch(input[key] as string, pattern),
  );
}

export default function (pi: ExtensionAPI): void {
  const repositories = new RepositoryRegistryService();
  let checks: Check[] = [];
  let failFast = true;
  let maxRetries = 5;
  let retriesUsed = 0;
  let toolRules: ToolRule[] = [];

  pi.on('agent_start', () => {
    retriesUsed = 0;
  });

  pi.on('session_start', async (_event, ctx) => {
    try {
      const loadedConfig = loadConfig(ctx.cwd);
      const config = loadedConfig?.agent_before_settle;
      checks = config?.checks ?? [];
      failFast = config?.failFast ?? true;
      maxRetries = config?.maxRetries ?? 5;
      toolRules = loadedConfig?.tool_call?.rules ?? [];
      await repositories.getOrCreate(ctx.cwd).snapshot(checks);
    } catch (error) {
      checks = [];
      failFast = true;
      maxRetries = 5;
      toolRules = [];
      ctx.ui.notify(`pi-hooks: ${(error as Error).message}`, 'error');
    }
  });

  pi.on('tool_call', (event) => {
    const rule = toolRules.find(
      (candidate) =>
        candidate.action === 'block' && matches(candidate, event.toolName, event.input),
    );
    if (rule?.action === 'block') return { block: true, reason: rule.reason };
  });

  pi.on('tool_result', (event) => {
    const rule = toolRules.find(
      (candidate) =>
        candidate.action === 'nudge' && matches(candidate, event.toolName, event.input),
    );
    if (rule?.action !== 'nudge') return;
    return {
      content: [
        ...event.content,
        { type: 'text' as const, text: `\n\n[pi-hooks nudge] ${rule.text}` },
      ],
      structuredContent: event.structuredContent,
    };
  });

  pi.on('agent_before_settle', async (event, ctx) => {
    if (checks.length === 0) return;
    const repository = repositories.getOrCreate(ctx.cwd);
    const results = await repository.check(checks, async (check, index) => {
      const name = check.name?.trim() || String(index + 1);
      ctx.ui.setStatus('pi-hooks', `Running: ${name}`);
      try {
        await runCheck(check, { cwd: repository.path, event: { outcome: event.outcome } });
      } finally {
        ctx.ui.setStatus('pi-hooks', undefined);
      }
    }, failFast);
    const failures = results.map(({ check, index, error }) => {
      const name = check.name?.trim() || String(index + 1);
      const detail = error as Error & { stdout?: string; stderr?: string };
      const output = [detail.message, detail.stdout, detail.stderr].filter(Boolean).join('\n');
      return `${name}: ${output}`;
    });

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
