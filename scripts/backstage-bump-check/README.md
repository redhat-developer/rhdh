# Backstage bump checks

Catches breakage from a Backstage dependency bump in pull request CI, before E2E runs.
Tracked in [RHIDP-13523](https://redhat.atlassian.net/browse/RHIDP-13523).

## When it runs

The `detect-backstage-bump` action marks a pull request as a bump when one of these holds:

- `backstage.json` changed.
- `yarn.lock` changes the resolved version of any `@backstage/*` package. This includes partial updates such as security fixes.
- The PR adds, removes or edits a Yarn patch under `.yarn/patches/`, or `yarn.lock` changes which patches are applied. Fixes from the `patch-backstage` workflow, including CVE backports, land this way ([RHIDP-13524](https://redhat.atlassian.net/browse/RHIDP-13524)).
- The PR changes this folder or the detection action. This lets PRs that edit the checks test them.

A PR that only bumps third-party scopes, such as `@backstage-community/*`, or non-Backstage dependencies without a patch, is not detected. A bump PR with `[skip-build]` in a commit subject still skips the build and test jobs, as any PR does.

For those PRs, `.github/workflows/pr.yaml` then:

- Builds and tests every package, not only the ones turbo reports as `--affected`. The build includes `tsc`.
- Runs the `Backstage bump checks` job, described below.

For a Yarn patch, the full test run exercises the patched code only where existing unit tests reach it, and the API surface diff only covers `@backstage/*` packages. E2E remains the integration gate. Patches under `dynamic-plugins/.yarn/patches/` are not detected: the checks only cover the root Yarn project.

## What the job checks

The job takes two snapshots and compares them:

- **Head**: the checked-out merge commit, with the PR's dependencies installed.
- **Base**: the merge commit's first parent, so the exact tree the PR merges into. It is a plain checkout in a separate worktree, installed with its own `yarn.lock`.

The base is always a commit that already installs cleanly. So the job keeps working when the PR adds, removes or renames workspace packages, or changes the Yarn version. The base worktree sits outside the workspace, so the `node_modules` cache saved for the PR lockfile never picks up base packages.

| Check         | How                                                                                                       | Result                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Config schema | `backstage-cli config:check --lax --strict` with the app-config files the container loads                 | The job fails when the PR adds error lines |
| API surface   | Diff of the published `dist/**/*.d.ts` of every `@backstage/*` package that a workspace declares directly | Report only                                |

Each snapshot reads the `--config` files from its own `build/containerfiles/Containerfile` ENTRYPOINT. So a PR that renames an app-config file is checked against the files its image loads.

`config:check` without `--strict` ignores schema errors. Even with `--strict`, the current config already fails: some keys belong to dynamic plugins, and their schemas are not in this repo. So the check compares the two sets of errors and fails only on new ones. A schema error is identified by its params and config path, such as `{ additionalProperty=foo } at /app`, not by its message. So a `@backstage/config-loader` bump that rewords messages does not make old errors look new. The trade-off: two different rules that report the same params at the same path, such as `minItems` and `maxItems` with one limit, count as one error. Checkout paths are masked, so base and head compare equal. A `config:check` that exits non-zero without its usual error block is recorded as an error, never as a clean run.

The job summary shows the result. The `backstage-bump-report` artifact holds `summary.md` and the full `api-surface.diff`. Its table flags a bump outside the caret range of the old version as `breaking range`. When workspaces resolve different versions of the same package, the table lists every version. The snapshot records which version each workspace resolves, and the job diffs every version a workspace moved between. If no workspace moved, for example because only a new workspace uses the new version, it diffs the newest version on each side.

## Run it locally

```bash
# With the PR's dependencies installed:
node scripts/backstage-bump-check/index.mjs snapshot /tmp/bump/head

# In a separate worktree of the base commit, with its dependencies installed:
git worktree add --detach /tmp/rhdh-base <base-commit>
(cd /tmp/rhdh-base && yarn install --immutable \
  && node "$OLDPWD/scripts/backstage-bump-check/index.mjs" snapshot /tmp/bump/base)

node scripts/backstage-bump-check/index.mjs compare /tmp/bump/base /tmp/bump/head /tmp/bump/report
node --test scripts/backstage-bump-check/lib.test.mjs
```
