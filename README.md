# @michalkvasnicak/pi-hooks

Configurable hooks for [Pi](https://github.com/earendil-works/pi): block or nudge tool calls and run repository checks before the agent finishes.

- Block tool calls or add guidance to their results using glob-based rules.
- Run commands or TypeScript scripts before the agent finishes, with automatic retries on failure.
- Skip checks when their configured input files haven't changed.

## Development

```sh
pnpm install
pnpm check
pi --extension ./src/index.ts
```

The package manifest points Pi package discovery at `src/index.ts`.

## Repository checks

The extension reads `.pi/pi-hooks.json` first, then `.pi-hooks.json` from the current repository root. The config is validated against the Zod schema in `src/config.ts`; `config.schema.json` documents the JSON format.

```json
{
  "$schema": "./config.schema.json",
  "hooks": {
    "tool_call": {
      "rules": [
        { "match": { "tool": "bash", "arguments": { "command": "*rm -rf*" } }, "action": "block", "reason": "Destructive shell commands are not allowed." },
        { "match": { "tool": "read", "arguments": { "path": "**/.env*" } }, "action": "nudge", "text": "Avoid reading secrets; use documented configuration instead." }
      ]
    },
    "agent_before_settle": {
      "failFast": true,
      "maxRetries": 5,
      "checks": [
        { "name": "Lint", "type": "command", "command": "pnpm lint" },
        { "type": "script", "path": ".pi-hooks/check.ts" }
      ]
    }
  }
}
```

### Tool-call rules

Rules match tool names and string arguments using glob patterns. All patterns in a rule must match.

- `block` prevents the call and tells the agent why.
- `nudge` lets the call run and adds guidance to its result.

Rules run in order. The first matching block stops the call; blocked calls receive no nudges.

### Checks before finishing

- **Commands** run in the repository root. A non-zero exit code fails the check.
- **Scripts** use repository-relative paths and default-export an async function receiving `{ cwd, event }`. Throw an error or return a non-empty string to fail. Script edits are picked up on the next run.

Failures go back to the agent so it can fix them. `maxRetries` limits retries (default: `5`). `failFast` stops at the first failure (default: `true`); set it to `false` to run all checks.

### Skip unchanged checks

Add `inputs` with repository-relative glob patterns to run a check only when matching files change or are deleted. Checks without `inputs` always run. The cache lasts until the extension restarts.
