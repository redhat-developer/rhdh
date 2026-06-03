# yarn-lockfile-surgeon

Surgically bump packages in a Yarn Berry (v3+) lockfile to their **minimum
satisfying versions**, without re-resolving unrelated transitive dependencies.

## Why

Yarn's built-in `yarn up` and `yarn install` always resolve new dependency
ranges to the **latest** matching version. On an LTS branch where lockfile
stability matters (e.g. security patches), this pulls in far more changes than
necessary.

This tool resolves to the **lowest** version that satisfies each range,
keeping the lockfile diff as small as possible.

## How it works

1. Removes old lockfile entries for the target packages (including any `patch:` entries)
2. Fetches the new version's metadata from the npm registry
3. For each new dependency range not satisfied by an existing lockfile entry,
   resolves to the **minimum satisfying version**
4. Walks transitive dependencies to catch cascading range bumps
5. Writes the updated lockfile with empty checksums —
   `yarn install --mode=update-lockfile` fills these in

## Usage

The tool only modifies `yarn.lock`. Before running it, you need to:

1. Update direct dependency versions in your `package.json` files
2. Remove any `patch:` resolutions from `package.json` for the packages being upgraded
3. Delete the corresponding `.yarn/patches/` files

Then run:

```bash
cd scripts/yarn-lockfile-surgeon
npm install  # first time only

yarn-lockfile-surgeon yarn.lock \
  @scope/package-a@1.2.3 \
  @scope/package-b@4.5.6

# Then, from the directory containing yarn.lock
yarn install --mode=update-lockfile
```

## Comparison with `yarn up`

Given `@backstage/backend-defaults@0.12.2` which declares
`@backstage/config: ^1.3.4` (current lockfile has 1.3.3):

| Tool                   | Resolves `^1.3.4` to | Result                          |
| ---------------------- | -------------------- | ------------------------------- |
| `yarn up`              | 1.3.7 (latest)       | Cascading transitive upgrades   |
| `yarn-lockfile-surgeon`   | 1.3.4 (minimum)      | Only the required patch version |

## Known limitations

**Extra entries from `yarn install`**: When `yarn install --mode=update-lockfile`
fills in checksums, it may also add new lockfile entries for dependency ranges
introduced by second-order transitive dependencies. These resolve to the
**latest** version since they go through Yarn's standard resolver. The extra
entries are additive and harmless, but make the diff slightly larger than the
theoretical minimum.

**Unresolvable ranges**: If no published version satisfies a transitive
dependency range, the tool logs a warning and skips it. The range will be left
for `yarn install` to resolve using its default (latest) strategy.

## Prior art

pnpm has a built-in [`resolution-mode: lowest-direct`](https://pnpm.io/settings#resolution-mode)
setting that resolves direct dependencies to their lowest matching version.
Yarn Berry has no equivalent — this tool fills that gap for lockfile-level
bumps.
