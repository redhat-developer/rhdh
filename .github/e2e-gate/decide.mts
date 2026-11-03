// Pure decision logic for the e2e-ocp-helm gate. No I/O, so it is unit tested
// with `node --test ".github/e2e-gate/*.test.mts"`.
import {
  GATE_BOT_LOGIN,
  GATE_STATUS_CREATOR,
  MANUAL_TRIGGER_AUTHORS,
  NO_CLUSTER_PATHS,
  OK_TO_TEST_LABEL,
  PREBUILT_IMAGE_OK_PATHS,
  SKIP_E2E_AUTHORS,
  SKIP_E2E_TAG,
  TRUSTED_ASSOCIATIONS,
} from "./rules.mts";

export const TEST_COMMAND = "/test e2e-ocp-helm";
export const STATUS_CONTEXT = "ci/prow/e2e-ocp-helm";

export interface GateInput {
  /** Changed file paths in the PR, including the old path of renamed files. */
  files: string[];
  /** PR author login. */
  author: string;
  /** GitHub author_association of the PR author. */
  authorAssociation: string;
  /** True when the author is a (possibly private) member of the repo's org. */
  orgMember: boolean;
  title: string;
  labels: string[];
  /** True while the PR is a draft. */
  draft: boolean;
  /** Conclusion of the "PR Build Image (Hermetic)" run. */
  buildConclusion: string;
  /** Result of the podman-push job. */
  publishResult: string;
  /** True when the image build and push were skipped. */
  imageSkipped: boolean;
}

/**
 * run  - ask Prow to run the job
 * skip - report the status as success without a cluster
 * wait - report the status as pending until someone comments /test
 * fail - report the status as failure (there is nothing to test)
 */
export type GateAction = "run" | "skip" | "wait" | "fail";

export interface GateDecision {
  action: GateAction;
  reason: string;
}

/** Returns the no-cluster category for a path, or null if it needs a cluster. */
export function noClusterCategory(path: string): string | null {
  for (const { category, pattern } of NO_CLUSTER_PATHS) {
    if (pattern.test(path)) return category;
  }
  return null;
}

export interface PullRequestFile {
  filename: string;
  previous_filename?: string;
}

/**
 * Every path a PR touches. A rename also changes its old path: renaming a
 * values file the Helm job reads must still run the job.
 */
export function changedPaths(files: PullRequestFile[]): string[] {
  return [
    ...new Set(
      files.flatMap((f) =>
        f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
      ),
    ),
  ];
}

export interface CommitStatus {
  context: string;
  state: string;
  creator?: { login: string } | null;
}

/**
 * Returns the newest ci/prow/e2e-ocp-helm status if Prow wrote it, else null.
 * `statuses` is newest first, as the GitHub API returns it. Once Prow has
 * reported on a commit, its result stands and the gate does nothing.
 */
export function prowStatus(statuses: CommitStatus[]): CommitStatus | null {
  const latest = statuses.find((s) => s.context === STATUS_CONTEXT);
  if (!latest || latest.creator?.login === GATE_STATUS_CREATOR) return null;
  return latest;
}

export interface IssueComment {
  body?: string;
  user?: { login: string } | null;
}

export function runRequestMarker(headSha: string): string {
  return `<!-- e2e-ocp-gate sha=${headSha} -->`;
}

/** True when the gate bot already asked Prow to test this commit. */
export function alreadyRequested(
  comments: IssueComment[],
  headSha: string,
): boolean {
  const marker = runRequestMarker(headSha);
  return comments.some(
    (c) =>
      c.user?.login === GATE_BOT_LOGIN &&
      c.body?.startsWith(TEST_COMMAND) === true &&
      c.body.includes(marker),
  );
}

export function decide(input: GateInput): GateDecision {
  const { files, author, authorAssociation, title, labels } = input;

  if (files.length > 0) {
    const categories = files.map(noClusterCategory);
    if (categories.every((c): c is string => c !== null)) {
      const names = [...new Set(categories)]
        .sort((a, b) => a.localeCompare(b))
        .join(", ");
      return {
        action: "skip",
        reason: `No cluster needed: only ${names} changed`,
      };
    }
  }

  if (SKIP_E2E_AUTHORS.has(author) && title.includes(SKIP_E2E_TAG)) {
    return {
      action: "skip",
      reason: `Skipped: automated ${SKIP_E2E_TAG} PR from ${author}`,
    };
  }

  // Image problems come before every "comment /test" answer: without an image
  // Prow would claim a cluster and wait 60 minutes for nothing.
  if (input.buildConclusion !== "success") {
    return {
      action: "fail",
      reason: `PR image build ended with "${input.buildConclusion}"`,
    };
  }
  if (input.imageSkipped) {
    if (!files.every((f) => PREBUILT_IMAGE_OK_PATHS.test(f))) {
      return {
        action: "fail",
        reason:
          "Image build was skipped ([skip-build]) for a product change; push without [skip-build] to build one",
      };
    }
  } else if (input.publishResult !== "success") {
    return {
      action: "fail",
      reason: "PR image was built but could not be published",
    };
  }

  if (MANUAL_TRIGGER_AUTHORS.has(author)) {
    return {
      action: "wait",
      reason: `Dependency PR: comment ${TEST_COMMAND} when it is ready to merge`,
    };
  }

  const trusted =
    TRUSTED_ASSOCIATIONS.has(authorAssociation) ||
    input.orgMember ||
    labels.includes(OK_TO_TEST_LABEL);
  if (!trusted) {
    return {
      action: "wait",
      reason: `Needs /ok-to-test from a member, then ${TEST_COMMAND}`,
    };
  }

  // Prow never auto-ran presubmits on drafts. Marking a PR ready does not
  // re-run the gate (that would rebuild the image), so the next push or a
  // manual /test does.
  if (input.draft) {
    return {
      action: "wait",
      reason: `Draft PR: comment ${TEST_COMMAND}, or push once it is ready for review`,
    };
  }

  return {
    action: "run",
    reason: "Running e2e-ocp-helm on an ephemeral OCP cluster",
  };
}
