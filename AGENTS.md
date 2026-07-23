# rhdh

Enterprise-grade Internal Developer Portal based on Backstage, with dynamic plugin support.

## Build & Test Commands

- Install: `yarn install`
- Build all: `yarn build`
- Dev (frontend + backend): `yarn dev`
- Start (backend only): `yarn start`
- Test all: `yarn test`
- Lint check: `yarn lint:check`
- Lint fix: `yarn lint:fix`
- Type check: `yarn tsc`
- Format check: `yarn prettier:check`
- Format fix: `yarn prettier:fix`
- Single-file lint: `npx eslint <path/to/file.ts>`
- Single-file type check: `yarn tsc --noEmit` (from the relevant package directory)
- Clean: `yarn clean`

Turborepo is used for task orchestration. Scope to a single package with `--filter`:

```bash
yarn build --filter=backend
yarn test --filter=@internal/plugin-scalprum-backend
```

## Key Conventions

<!-- 3-5 rules the agent can't infer from the code itself -->

## Architecture

<!-- Where to find things that aren't obvious from directory names -->
