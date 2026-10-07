# pi-hooks

A TypeScript [Pi extension](https://github.com/earendil-works/pi) scaffold.

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

Commands run in the repository root; a non-zero exit status fails the check. A script path is repository-relative and must default-export an async function receiving `{ cwd, event }`. Throw an error or return a non-empty string to fail the check; the failure is sent to the agent. `maxRetries` (default `5`) limits automatic continuations after failed checks; once exhausted, the failure is reported without continuing. `failFast` defaults to `true`; set it to `false` to run every check. Scripts are loaded without module caching so edits are picked up on subsequent checks.

Checks may declare `inputs` as repository-relative glob patterns. A check is skipped when its matched files have not changed since the last successful run; checks without `inputs` always run. Input snapshots and file hashes are cached in memory for the lifetime of the extension process; after a restart, checks run again. Deleted files also change the snapshot. File hashes are reused when size and modification time match; tracked files reported changed by Git are re-hashed.
