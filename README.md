# pi-hooks

A TypeScript [Pi extension](https://github.com/earendil-works/pi) scaffold.

## Development

```sh
pnpm install
pnpm check
pi --extension ./src/index.ts
```

The scaffold registers `/pi-hooks` as a smoke-test command. Implement extension behavior in `src/index.ts` (or split it into additional modules). The package manifest points Pi package discovery at that entry point.
