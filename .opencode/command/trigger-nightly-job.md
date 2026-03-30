---
description: >-
  Trigger RHDH nightly CI jobs on demand via the OpenShift CI Gangway REST API.
  Allows natural language selection of jobs and image tags.
---
# Trigger Nightly Job

Trigger RHDH nightly ProwJobs via `.ci/pipelines/trigger-nightly-job.sh`.

## Flow

1. Fetch available jobs and let the user pick one
2. Ask about image override and additional options (fork, alerts)
3. Show the command, confirm, execute, report results

## Step 1: Fetch Jobs and Select

Fetch configured nightly jobs:

```bash
curl -s 'https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh' | grep -oE '"name":"periodic-ci-[^"]*-nightly"' | sed 's/"name":"//;s/"//' | sort
```

Present the jobs in a table with columns: short name and which branches have it. Derive the short name from the job name part after the branch segment (e.g. `e2e-ocp-helm-nightly` → "OCP Helm"):

| Job | main | release-1.9 | release-1.8 |
|-----|------|-------------|-------------|
| OCP Helm | x | x | x |
| AKS Helm | x | x | |

Then ask the user to describe which job and branch they want in natural language.

### Natural Language Mapping

Map the user's description to the matching full job name from the fetched list. If no branch is mentioned, default to `main`:
- "ocp helm" / "openshift helm" → `e2e-ocp-helm-nightly` (not upgrade, not versioned)
- "operator" / "ocp operator" → `e2e-ocp-operator-nightly` (not auth-providers)
- "helm upgrade" / "upgrade test" → `e2e-ocp-helm-upgrade-nightly`
- "auth providers" / "authentication" → `e2e-ocp-operator-auth-providers-nightly`
- "4.17", "4.19", "4.20", "4.21" → `e2e-ocp-v4-{VERSION}-helm-nightly`
- "aks helm" / "azure helm" → `e2e-aks-helm-nightly`
- "aks operator" / "azure operator" → `e2e-aks-operator-nightly`
- "eks helm" / "aws helm" → `e2e-eks-helm-nightly`
- "eks operator" / "aws operator" → `e2e-eks-operator-nightly`
- "gke helm" / "google helm" → `e2e-gke-helm-nightly`
- "gke operator" / "google operator" → `e2e-gke-operator-nightly`
- "osd" / "osd gcp" → `e2e-osd-gcp-helm-nightly` or `e2e-osd-gcp-operator-nightly`
- Branch: "1.9", "release 1.9", "1.8 branch" → match from that branch
- Multiple: "all AKS jobs", "all Operator jobs on main" → offer to trigger them in sequence

### Shared Cluster Constraint (GKE / OSD-GCP only)

GKE and OSD-GCP each share a single cluster — never run two jobs on the same platform simultaneously. Before triggering, warn the user and check:

```bash
curl -s 'https://prow.ci.openshift.org/api/v1/prowjobs?state=triggered&state=pending' 2>/dev/null | jq -r '.items[]?.spec.job // empty' | grep -i '<PLATFORM>' || echo "No running jobs found (note: check may not be fully reliable)"
```

If inconclusive, the user can check: `https://prow.ci.openshift.org/?type=periodic&job=*<PLATFORM>*nightly*`

## Step 2: Options

Present all options together. The user picks by number — multiple selections allowed (e.g. "2, 5"):

**Image override:**
1. **Default image** — no image flags, use whatever the job is configured with
2. **Custom tag only** — override just the tag, keep default registry and repo
3. **Custom repo + tag** — override image repository and tag, keep default registry (`quay.io`)
4. **Fully custom image** — override registry, repo, and tag

**Additional options:**
5. **Fork override** — run against a fork instead of `redhat-developer/rhdh`
6. **Send Slack alerts** — notify at # `--send-alerts`

Constraint: `--image-repo` requires `--tag`, but `--tag` works on its own.

### Follow-up based on selections

**If 2 or 3 selected (quay.io registry)** — fetch available tags and present as numbered options:

```bash
curl -s 'https://quay.io/api/v1/repository/<REPO>/tag/?limit=20&onlyActiveTags=true&filter_tag_name=like:1.' | jq -r '.tags[].name | select(test("^[0-9]+\\.[0-9]+(-[0-9]+)?$"))' | sort -V | tail -20
```

Where `<REPO>` is the image repository (default: `rhdh/rhdh-hub-rhel9`). Present numbered results with a final option to enter a custom tag (e.g. `next`, `latest`). For option 3, also ask for the image repository.

**If 4 selected (non-quay registry)** — ask for all three values (tag fetching not available):
- Registry (e.g. `brew.registry.redhat.io`)
- Image repo (e.g. `rhdh/rhdh-hub-rhel9`)
- Tag (e.g. `1.9-42`)

**If 5 selected** — ask for:
- GitHub org (`--org`): e.g. `my-github-user`
- Repo name (`--repo`): e.g. `rhdh`
- Branch (`--branch`): e.g. `my-feature-branch`

## Step 3: Confirm and Execute

Show the full command and present final options:

```bash
.ci/pipelines/trigger-nightly-job.sh \
  --job <FULL_JOB_NAME> \
  [--image-registry <REGISTRY>] \
  [--image-repo <REPO>] \
  [--tag <TAG>] \
  [--org <ORG>] \
  [--repo <REPO>] \
  [--branch <BRANCH>] \
  [--send-alerts] \
  [--dry-run]
```

1. **Execute** — run the command as shown
2. **Change something** — go back and modify parameters

After execution, show the API response. If a job URL or ID is returned, display it prominently. On error, help diagnose (common issues: expired token, invalid job name).

## Reference

- Script flags: `-j/--job`, `-I/--image-registry`, `-q/--image-repo`, `-t/--tag`, `-o/--org`, `-r/--repo`, `-b/--branch`, `-S/--send-alerts`, `-n/--dry-run`
- Dedicated kubeconfig at `~/.config/openshift-ci/kubeconfig` — won't interfere with your current cluster context
- If auth is needed, the script opens a browser for SSO login
- Jobs list: https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh
- Image tags: https://quay.io/repository/rhdh/rhdh-hub-rhel9?tab=tags
