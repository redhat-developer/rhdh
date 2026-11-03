// Rules for the e2e-ocp-helm gate (RHIDP-16423).
//
// The Prow job `ci/prow/e2e-ocp-helm` claims an ephemeral OpenShift cluster
// every time it runs. Prow no longer triggers it on push; the "Decide
// e2e-ocp-helm" job in pr-podman-push.yaml applies these rules once the PR
// image is published, then either asks Prow to run the job or reports the
// required status itself.
//
// workflow_run workflows always run from the default branch, so this file on
// `main` decides for PRs against every branch.

// Base branches that have the e2e-ocp-helm Prow job. PRs against other
// branches are left alone.
export const GATED_BASE_BRANCHES = /^(main|release-\d+\.\d+)$/;

export interface PathRule {
  category: string;
  pattern: RegExp;
}

// A PR whose changed files ALL match these patterns does not need a cluster.
// The status is set to success with the category names as the reason.
// Keep patterns anchored and specific: anything not listed here runs.
export const NO_CLUSTER_PATHS: PathRule[] = [
  {
    category: "docs",
    pattern: /^docs\/|^showcase-docs\/|\.mdx?$|\.mdc$|^mkdocs\.yaml$/,
  },
  {
    category: "repo tooling",
    pattern:
      /(^|\/)OWNERS(_ALIASES)?$|^\.changeset\/|^\.github\/|^scripts\/|^\.threatmodel\/|\.toml$|^(renovate\.json|codecov\.yml|catalog-info\.yaml|\.sonarcloud\.properties|\.editorconfig|\.gitignore|\.prettierignore|\.shellcheckrc|\.lintstagedrc\.cjs|LICENSE|DCO|rpms\.lock\.yaml)$/,
  },
  {
    category: "AI agent config",
    pattern: /^\.(claude|cursor|opencode|rulesync|agents|vscode|husky)\//,
  },
  {
    // Covered by the "E2E Cluster-free" workflow, not by an OCP cluster.
    category: "cluster-free e2e harness",
    pattern:
      /^e2e-tests\/(unit\/|local-harness\/|local-[^/]+$|playwright\/cluster-free\/|playwright\.(local|plugin-sanity)\.config\.ts$)/,
  },
  {
    // CI for other platforms and install methods. The OCP Helm PR check only
    // runs .ci/pipelines/jobs/ocp-pull.sh. Syntax errors in these files are
    // still caught by the "E2E Bash" ShellCheck workflow.
    // cleanup.sh sources cluster/gke/gcloud.sh and cluster/eks/aws.sh in every
    // job, including the OCP Helm one, so those two always run.
    category: "CI for other platforms",
    pattern:
      /^\.ci\/pipelines\/(cluster\/(?!gke\/gcloud\.sh$|eks\/aws\.sh$)|jobs\/(aks|eks|gke|osd|ocp-disconnected|ocp-fips|ocp-localization|ocp-nightly|ocp-operator|auth-providers|upgrade)[^/]*\.sh$|install-methods\/operator\.sh$|lib\/disconnected|resources\/(disconnected|rhdh-operator)\/|value_files\/[^/]*(AKS|EKS|GKE|sanity|fips|disconnected)[^/]*$)/,
  },
];

// Automated PRs from these authors with [skip-e2e] in the title pass without
// a cluster (base image bumps, lockfile updates).
export const SKIP_E2E_AUTHORS = new Set(["rhdh-bot"]);
export const SKIP_E2E_TAG = "[skip-e2e]";

// Dependency bots rebase their PRs many times before anyone merges them, and
// each rebase used to claim a cluster. For these authors the gate waits for a
// reviewer to comment `/test e2e-ocp-helm` once the PR is ready to merge.
export const MANUAL_TRIGGER_AUTHORS = new Set([
  "renovate[bot]",
  "dependabot[bot]",
]);

// GitHub author_association values that Prow also trusts.
export const TRUSTED_ASSOCIATIONS = new Set([
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
]);
export const OK_TO_TEST_LABEL = "ok-to-test";

// When every changed file is under these directories, the Prow step tests the
// `next` image instead of waiting for a PR image, so the job can run even when
// the image build was skipped. Must match DIRECTORIES_TO_CHECK in
// openshift/release redhat-developer-rhdh-ocp-helm-commands.sh; any other
// change makes Prow wait up to 60 minutes for a PR image.
export const PREBUILT_IMAGE_OK_PATHS =
  /^(\.ci|e2e-tests|docs|\.claude|\.cursor|\.opencode|\.rulesync|\.vscode)\//;

// Login behind RHDH_BOT_TOKEN. Only its comments count as earlier run requests.
export const GATE_BOT_LOGIN = "rhdh-bot";

// Login that writes commit statuses with GITHUB_TOKEN. Any other author of a
// ci/prow/e2e-ocp-helm status is Prow, and the gate never overwrites it.
export const GATE_STATUS_CREATOR = "github-actions[bot]";
