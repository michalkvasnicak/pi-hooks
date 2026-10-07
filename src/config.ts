import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const commandCheckSchema = z
  .object({
    name: z.string().optional(),
    inputs: z.array(z.string().min(1)).optional(),
    type: z.literal('command'),
    command: z.string().min(1),
  })
  .strict();

const scriptCheckSchema = z
  .object({
    name: z.string().optional(),
    inputs: z.array(z.string().min(1)).optional(),
    type: z.literal('script'),
    path: z.string().min(1),
  })
  .strict();

const toolRuleSchema = z.discriminatedUnion('action', [
  z
    .object({
      match: z
        .object({
          tool: z.string().min(1),
          arguments: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
      action: z.literal('block'),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      match: z
        .object({
          tool: z.string().min(1),
          arguments: z.record(z.string(), z.string()).optional(),
        })
        .strict(),
      action: z.literal('nudge'),
      text: z.string().min(1),
    })
    .strict(),
]);

const agentBeforeSettleSchema = z
  .object({
    failFast: z.boolean().default(true),
    maxRetries: z.number().int().nonnegative().default(5),
    checks: z.array(z.discriminatedUnion('type', [commandCheckSchema, scriptCheckSchema])),
  })
  .strict();

const toolCallSchema = z.object({ rules: z.array(toolRuleSchema) }).strict();

export const piHooksConfigSchema = z
  .object({
    agent_before_settle: agentBeforeSettleSchema.optional(),
    tool_call: toolCallSchema.optional(),
  })
  .strict();

export type PiHooksConfig = z.infer<typeof piHooksConfigSchema>;
export type Check = NonNullable<PiHooksConfig['agent_before_settle']>['checks'][number];
export type ToolRule = NonNullable<PiHooksConfig['tool_call']>['rules'][number];

export function loadConfig(cwd: string): PiHooksConfig | undefined {
  const paths = [resolve(cwd, '.pi/pi-hooks.json'), resolve(cwd, '.pi-hooks.json')];
  const configPath = paths.find(existsSync);

  if (!configPath) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse ${configPath}: ${(error as Error).message}`);
  }

  const parsed = piHooksConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${configPath}: ${parsed.error.message}`);
  }
  return parsed.data;
}
