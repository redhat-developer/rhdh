# PR CI and Merging

How PRs get `e2e-ocp-helm` and merge is explained in [`docs/e2e-tests/CI.md` → How PRs Are Tested and Merged](../../e2e-tests/CI.md#how-prs-are-tested-and-merged). In short: e2e does not run on push; the pipeline controller starts it when a PR gets `lgtm`, and Tide merges once `ci/pipeline-gate` is green and e2e passed.

## Rules for Agents

- **Getting e2e results:** comment `/test e2e-ocp-helm`; it will not start on its own after a push. External PRs need `/ok-to-test` first.
- **Never add `lgtm` or `approved` by hand**, and do not `/lgtm` your own PR.
- **Never use `/override` or `/pipeline mark-pipeline-gate`** to merge without e2e. The only routine `/override` is the auto-approve workflow's on `[skip-e2e]` bot PRs.
- **PR not merging:** check that `ci/pipeline-gate` is green on HEAD, `e2e-ocp-helm` passed if it ran, the PR has `lgtm`, and no `do-not-merge/*` or `jira/invalid-bug` label. Approved but no gate: comment `/pipeline remaining`.
- **Changing which files skip e2e:** edit `pipeline_skip_if_only_changed` in every `ci-operator/config/redhat-developer/rhdh/*.yaml` in openshift/release and run `make jobs WHAT=redhat-developer/rhdh`. RE2 only, no lookahead.
- **Changing `auto-approve-bot-prs.yaml`:** backport to every active `release-*` branch, and follow [`github-workflows-security.md`](github-workflows-security.md).
