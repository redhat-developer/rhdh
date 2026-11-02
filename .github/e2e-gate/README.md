# e2e-ocp-helm gate

The `ci/prow/e2e-ocp-helm` PR check claims an ephemeral OpenShift cluster from
a Hive pool on every run, and every claim costs money. Between 2026-09-16 and
2026-11-02 the check claimed 792 clusters, and about 43% of those claims were
avoidable (RHIDP-16423):

- Renovate PRs were re-tested on every rebase (238 claims on 6 PRs).
- rhdh-bot `[skip-e2e]` PRs claimed a cluster and then exited without testing (76).
- PRs that only changed docs, tooling, the cluster-free harness or CI for
  other platforms still ran (44).
- Runs claimed a cluster and then waited up to 60 minutes for the PR image.

Prow no longer starts the job on push. Instead, the **Decide e2e-ocp-helm** job
in [`pr-podman-push.yaml`](../workflows/pr-podman-push.yaml) runs after the PR
image is published and decides what the PR needs.

## What the gate decides

| Decision | When                                                                                            | What happens                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `skip`   | Every changed file matches a no-cluster rule, or rhdh-bot opened a `[skip-e2e]` PR              | Sets `ci/prow/e2e-ocp-helm` to success with the reason                                                |
| `wait`   | Draft PR, Renovate or Dependabot PR, or an author Prow does not trust                           | Sets the status to pending, asking for `/test e2e-ocp-helm` (and `/ok-to-test` for untrusted authors) |
| `fail`   | The image build failed, publishing failed, or `[skip-build]` left no image for a product change | Sets the status to failure with the reason                                                            |
| `run`    | Anything else                                                                                   | rhdh-bot comments `/test e2e-ocp-helm` and Prow runs the job                                          |

The rules are in [`rules.mts`](rules.mts) and the decision order is in
[`decide.mts`](decide.mts). A path that no rule matches always runs, so a
missing rule costs a cluster rather than skipping a needed test.

The `ci/prow/e2e-ocp-helm` status is required for merge. openshift/release
sets `require_manually_triggered_jobs: true` for this repository, so Tide and
branch protection wait for the status even though Prow no longer starts the
job on its own.

## Running the job by hand

Comment `/test e2e-ocp-helm` on the PR at any time. A Prow run replaces any
status the gate set. Use this to:

- test a dependency PR before merging it,
- test a PR whose image build was skipped,
- test a change the gate skipped when you still want cluster coverage,
- test a draft PR. Drafts otherwise wait until they are marked ready for
  review, which re-runs the image build and the gate.

## Changing the rules

1. Edit `rules.mts` and add a case to `decide.test.mts`.
2. Run the tests: `node --test ".github/e2e-gate/*.test.mts"`. They need only
   Node.js from `.nvmrc`, with no install step.
3. The new rules take effect once they merge to `main`. `workflow_run` jobs
   always run from the default branch, so one copy of the rules covers PRs
   against every release branch, and a PR cannot test its own gate changes.

## Rollout switch

The `E2E_GATE_MODE` repository variable controls the gate:

- unset (default): the gate writes its decision to the job summary and does
  nothing else;
- `enforce`: the gate sets statuses and posts `/test` comments.

Set it to `enforce` when the openshift/release change that makes
`e2e-ocp-helm` manual-only merges. PRs pushed before the switch have no status
on their head commit, so push again or comment `/test e2e-ocp-helm`.

## Security

The gate job runs with repository secrets (`RHDH_BOT_TOKEN`). It checks out
only the default branch and reads the PR through the API; it never checks out
or runs PR code. rhdh-bot's comments bypass Prow's `/ok-to-test` check, so the
gate posts `/test` only for org members, collaborators, or PRs that already
have the `ok-to-test` label.
