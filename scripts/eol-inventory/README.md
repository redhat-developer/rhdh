# EOL dependency inventory

Inventory of **direct** dependencies for [RHIDP-13174](https://redhat.atlassian.net/browse/RHIDP-13174): this repo (RHDH core) plus generally-available and tech-preview overlay plugins. Use it to see what we ship that is unmaintained during the RHDH 2.2 support window.

This is an inventory only. It does not recommend upgrades.

## How to run

From the repository root. Needs network access to npm and GitHub ([rhdh-plugin-export-overlays](https://github.com/redhat-developer/rhdh-plugin-export-overlays) `main`).

```bash
yarn eol-inventory
```

That regenerates:

- [eol-dependency-inventory.csv](./eol-dependency-inventory.csv) — full list, one row per declaration
- [eol-dependency-inventory-report.md](./eol-dependency-inventory-report.md) — core table, then one table per overlay workspace

Commit those two files. Do not edit them by hand.

Re-run after you change direct dependencies.

Optional: `OVERLAYS_REF=<git-ref>` to read a branch other than `main`. `GITHUB_TOKEN` / `GH_TOKEN` avoids unauthenticated GitHub rate limits.

## What is scanned

Direct `dependencies`, `devDependencies`, `peerDependencies`, and `resolutions` from:

- root `package.json`
- `packages/*`
- `plugins/*`
- overlays **generally-available** and **tech-preview** plugins from GitHub (`spec.support` in [rhdh-plugin-export-overlays](https://github.com/redhat-developer/rhdh-plugin-export-overlays) `workspaces/*/metadata/*.yaml`), plus each plugin’s **published** direct deps from npm (not the overlay git tree)

The markdown report omits overlay `devDependencies` (test/build of the published package). Those rows stay in the CSV.

Not scanned: `yarn.lock` transitives, `dynamic-plugins/wrappers`, `community` or `dev-preview` plugins.

Workspace non-OK counts in the report are **not additive**. The same package can appear in more than one workspace. Tables are sorted by **impact** (high first), not alphabetically.

**Risk** is a hint, not a severity score: `runtime-prod` ships, `build` / `test-only` are tooling.

**Impact** is a lookup table in [`index.mjs`](./index.mjs) (`classifyImpact`). There is no weighted formula or CVE-style score. Each row gets two ranks, then the cell in this grid is the impact label. `impact_order` in the CSV is only for sorting (high = 0, then medium, low).

Usage (rows, most important first):

| Rank | Meaning |
| --- | --- |
| 0 | GA runtime (`dependencies` of core or generally-available plugins) |
| 1 | Tech-preview runtime |
| 2 | Build/test tooling (`devDependencies`, `@types/*`, jest, …) |

Outdatedness (columns, most stale first):

| Rank | Meaning |
| --- | --- |
| 0 | npm deprecated |
| 1 | Last publish older than 36 months |
| 2 | Last publish older than 18 months |
| 3 | None of the above |

|  | Deprecated | 36+ months | 18+ months | None |
| --- | --- | --- | --- | --- |
| GA runtime | high | high | medium | low |
| Tech-preview runtime | high | high | medium | low |
| Build/test tooling | low | low | low | low |

## How status is computed

Each run recomputes status. The CSV is a snapshot, not the source of truth.

Signals, in order:

1. npm **deprecated** → `unmaintained`
2. **Last publish** older than 18 months → `unmaintained`, else `OK`
3. No signal → `unknown`

Typical npm packages have no vendor EOL date, so this inventory does not use one.

| Input | Source |
| ----- | ------ |
| What we ship | `package.json`, overlays metadata on GitHub + npm |
| Deprecated / last publish | npm registry |
