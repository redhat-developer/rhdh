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
missing rule costs a cluster rather than skipping a needed test. A renamed
file counts under both its old and its new path.

Image problems are checked before any `wait`, so a PR whose image did not
build gets `fail` rather than an invitation to comment `/test`, which would
claim a cluster and wait 60 minutes for an image that does not exist.

"Trusted" means what Prow means: an org member (private members included,
checked with rhdh-bot's token), a collaborator, or a PR with `ok-to-test`.

Once Prow has reported `ci/prow/e2e-ocp-helm` on a commit, the gate leaves it
alone: it never replaces a Prow result and never requests a second run. A
cancelled image build does nothing, because the newer build decides. If the
gate itself fails, a fallback step sets the status to `error` with a link to
the run, so the PR never waits on a status that will not arrive.

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
- test a draft PR, or a PR just marked ready for review. Marking a PR ready
  does not re-run the gate, because that would rebuild the image; the next
  push does.

## Changing the rules

1. Edit `rules.mts` and add a case to `decide.test.mts`.
2. Run the tests: `node --test ".github/e2e-gate/*.test.mts"`. They need only
   Node.js from `.nvmrc`, with no install step.
3. The new rules take effect once they merge to `main`. `workflow_run` jobs
   always run from the default branch, so one copy of the rules covers PRs
   against every release branch, and a PR cannot test its own gate changes.

## Security

The gate job runs with repository secrets (`RHDH_BOT_TOKEN`). It checks out
only the default branch and reads the PR through the API; it never checks out
or runs PR code. rhdh-bot's comments bypass Prow's `/ok-to-test` check, so the
gate posts `/test` only for org members, collaborators, or PRs that already
have the `ok-to-test` label.
