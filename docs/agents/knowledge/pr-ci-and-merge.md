# PR CI and Merging

How PRs in this repo get the mandatory `e2e-ocp-helm` check and how they merge. The full explanation, with tables for contributor and bot PRs, commands, troubleshooting and config locations, is in [`docs/e2e-tests/CI.md` → How PRs Are Tested and Merged](../../e2e-tests/CI.md#how-prs-are-tested-and-merged). This file is the short version for agents; if the two disagree, `CI.md` wins.

## Key Facts

- Merging is done by Prow's Tide (`openshift-merge-bot`), not by people pressing the merge button. Tide merges a PR that matches a Tide query and has its required checks green.
- `e2e-ocp-helm` claims an ephemeral OpenShift cluster, so it does **not** run on push. The OpenShift CI pipeline controller (LGTM mode, all branches) starts it when the PR gets `lgtm`.
- `ci/pipeline-gate` is required for merge. The pipeline controller publishes it, per commit, when `lgtm` is added. Once `e2e-ocp-helm` has started, it must pass.
- The controller does not start `e2e-ocp-helm` when it already ran on the same commit, or when every changed file matches the job's `pipeline_skip_if_only_changed` pattern in openshift/release.
- Any new push removes `lgtm`, so the next approval runs e2e again on the new commit.
- Bot PRs on `chore/automated-*` branches merge with no human involved. [`auto-approve-bot-prs.yaml`](../../../.github/workflows/auto-approve-bot-prs.yaml) approves them and adds the merge label:
  - Every eligible bot PR gets `lgtm` and `approved`, so the controller starts `e2e-ocp-helm` like on any other approved PR.
  - If the title has `[skip-e2e]`, the job sees the title and the workflow's approval and exits without deploying or testing. It still claims a cluster; skipping that is a planned follow-up.

## Rules for Agents

- **Getting e2e results for a PR:** comment `/test e2e-ocp-helm`. Do not wait for it to start on its own after a push; it will not. External contributors' PRs need `/ok-to-test` from an org member first.
- **Do not add merge labels by hand:** never add `lgtm` or `approved` yourself, and do not post `/lgtm` on a PR you authored (Prow rejects it).
- **Do not bypass e2e:** never use `/pipeline mark-pipeline-gate` or `/override` to get a PR merged without `e2e-ocp-helm` passing. Leave those to maintainers.
- **Diagnosing a PR that does not merge:** check, in order: is `ci/pipeline-gate` present and green on the current HEAD; did `e2e-ocp-helm` pass if it ran; does the PR have `lgtm`; is there a blocking label (`do-not-merge/*`, `jira/invalid-bug`). For a missing gate on an approved PR, comment `/pipeline remaining`.
- **Changing which files skip e2e:** edit `pipeline_skip_if_only_changed` for `e2e-ocp-helm` in every `ci-operator/config/redhat-developer/rhdh/*.yaml` in openshift/release, then run `make jobs WHAT=redhat-developer/rhdh` there. The pattern must be RE2-compatible (no lookahead).
- **Changing `auto-approve-bot-prs.yaml`:** it runs on `pull_request_target` from the PR's **base** branch, so backport the change to every active `release-*` branch, or it only affects `main`. Follow [`github-workflows-security.md`](github-workflows-security.md) for `pull_request_target` safety.
- **Changing Tide queries, required checks or pipeline-controller enrolment:** these live in openshift/release, not in this repo: `core-services/prow/02_config/redhat-developer/rhdh/_prowconfig.yaml` (Tide, required checks), `core-services/prow/02_config/redhat-developer/rhdh/_pluginconfig.yaml` (delivers rhdh events to the controller) and `core-services/pipeline-controller/lgtm-config.yaml` (enrolment).
