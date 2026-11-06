import picomatch from 'picomatch';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig, type Check, type ToolRule } from './config.js';
import { RepositoryRegistryService } from './services/repository-registry.js';
import { CheckRunnerService } from './services/check-runner.js';
import { CheckFailureService } from './services/check-failure.js';

function matches(rule: ToolRule, toolName: string, input: Record<string, unknown>): boolean {
  if (!picomatch.isMatch(toolName, rule.match.tool)) return false;
  return Object.entries(rule.match.arguments ?? {}).every(
    ([key, pattern]) =>
      typeof input[key] === 'string' && picomatch.isMatch(input[key] as string, pattern),
  );
}

export default function (pi: ExtensionAPI): void {
  const repositories = new RepositoryRegistryService(new CheckRunnerService());
  const failureMessages = new CheckFailureService();
  let checks: Check[] = [];
  let failFast = true;
  let maxRetries = 5;
  let retriesUsed = 0;
  let toolRules: ToolRule[] = [];

  pi.on('session_start', async (_event, ctx) => {
    retriesUsed = 0;
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
    const results = await repository.check(checks, {
      event: { outcome: event.outcome },
      failFast,
      onProgress: (progress) => {
        switch (progress.type) {
          case 'started': {
            const name = progress.check.name?.trim() || String(progress.index + 1);
            ctx.ui.setStatus('pi-hooks', `Running: ${name}`);
            break;
          }
          case 'succeeded':
          case 'failed':
            ctx.ui.setStatus('pi-hooks', undefined);
            break;
          case 'skipped':
            break;
        }
      },
    });
    const failures = await Promise.all(results.map(({ check, index, error }) => {
      const name = check.name?.trim() || String(index + 1);
      return failureMessages.format(name, error);
    }));

    if (failures.length === 0) {
      retriesUsed = 0;
      return;
    }
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
