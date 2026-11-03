# e2e-ocp-helm gate

The `ci/prow/e2e-ocp-helm` PR check claims an ephemeral OpenShift cluster on
every run, and a large share of those claims were avoidable (RHIDP-16423):
Renovate rebases, rhdh-bot `[skip-e2e]` PRs, PRs that changed no product code,
and runs that sat on a cluster waiting for the PR image.

Prow no longer starts the job on push. The **Decide e2e-ocp-helm** job in
[`pr-podman-push.yaml`](../../.github/workflows/pr-podman-push.yaml) runs once the PR
image is published and decides what the PR needs.

## What the gate decides

| Decision | When                                                                                            | What happens                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `skip`   | Every changed file matches a no-cluster rule, or rhdh-bot opened a `[skip-e2e]` PR              | Sets `ci/prow/e2e-ocp-helm` to success with the reason                                                |
| `fail`   | The image build failed, publishing failed, or `[skip-build]` left no image for a product change | Sets the status to failure with the reason                                                            |
| `wait`   | Renovate or Dependabot PR, an author Prow does not trust, or a draft PR                         | Sets the status to pending, asking for `/test e2e-ocp-helm` (and `/ok-to-test` for untrusted authors) |
| `run`    | Anything else                                                                                   | rhdh-bot comments `/test e2e-ocp-helm` and Prow runs the job                                          |

Rules are checked in this order. They live in [`rules.mts`](rules.mts); the
order is in [`decide.mts`](decide.mts).

## Design decisions

| Decision                                  | Why                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decide in GitHub Actions, after the image | Prow claims the cluster before any job step runs, so a check inside the job is too late.                                                                                                                                                  |
| Unknown paths run                         | A missing rule costs a cluster, never a skipped test. A renamed file counts under its old and new path.                                                                                                                                   |
| Image problems before any `wait`          | A PR with no image gets `fail`, not "comment `/test`", which would claim a cluster and wait 60 minutes for nothing.                                                                                                                       |
| `[skip-build]` directories mirror Prow    | When the image build is skipped, the Prow step tests the `next` image only if every change is under its `DIRECTORIES_TO_CHECK`. `PREBUILT_IMAGE_OK_PATHS` must match it; anything else fails.                                             |
| Renovate and Dependabot wait              | They rebase many times before merge, and each rebase used to claim a cluster.                                                                                                                                                             |
| Trust matches Prow                        | rhdh-bot's `/test` bypasses `/ok-to-test`, so the gate only runs PRs from org members (private ones too, checked with rhdh-bot's token), collaborators, or PRs with `ok-to-test`.                                                         |
| Drafts wait; marking ready does nothing   | Re-running on `ready_for_review` would rebuild the image and need the trigger backported to every release branch. Comment `/test` or push instead.                                                                                        |
| Prow results win                          | Once Prow reports on a commit, the gate never overwrites it or requests a second run. A hidden marker in rhdh-bot's `/test` comment stops duplicate requests on re-runs.                                                                  |
| Cancelled builds do nothing               | `cancel-in-progress` cancels a build when a newer push starts one; that build decides.                                                                                                                                                    |
| Gate errors set `error`                   | If the gate fails, it sets `error` with a link to the run (unless Prow already reported), so Tide never waits on a status that will not arrive.                                                                                           |
| Still required for merge                  | openshift/release sets `require_manually_triggered_jobs: true`, so Tide waits for the status even though Prow no longer starts the job.                                                                                                   |
| One copy of the rules                     | `workflow_run` jobs run from `main`, so `main` decides for every release branch. A PR cannot test its own gate changes.                                                                                                                   |
| Plain `node` and `fetch`, no installs     | The job holds `RHDH_BOT_TOKEN`, so no third-party packages run in it. Node 24 runs the `.mts` files directly, like the other scripts in `scripts/`. `actions/github-script` would add Octokit but has no clean way to use a second token. |
| Never checks out PR code                  | The job checks out only the default branch and reads the PR through the API.                                                                                                                                                              |

## Running the job by hand

Comment `/test e2e-ocp-helm` at any time; a Prow run replaces any status the
gate set. Use it for dependency PRs before merging, drafts or PRs just marked
ready, PRs whose image build was skipped, or a skipped change you still want
tested on a cluster.

## Changing the rules

1. Edit `rules.mts` and add a case to `decide.test.mts`.
2. Run `node --test "scripts/e2e-gate/*.test.mts"` (Node from `.nvmrc`, no
   install).
3. The rules take effect once merged to `main`.
