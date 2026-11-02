// Pure decision logic for the e2e-ocp-helm gate. No I/O, so it is unit tested
// with `node --test ".github/e2e-gate/*.test.mts"`.
import {
  MANUAL_TRIGGER_AUTHORS,
  NO_CLUSTER_PATHS,
  OK_TO_TEST_LABEL,
  PREBUILT_IMAGE_OK_PATHS,
  SKIP_E2E_AUTHORS,
  SKIP_E2E_TAG,
  TRUSTED_ASSOCIATIONS,
} from "./rules.mts";

export const TEST_COMMAND = "/test e2e-ocp-helm";

export interface GateInput {
  /** Changed file paths in the PR. */
  files: string[];
  /** PR author login. */
  author: string;
  /** GitHub author_association of the PR author. */
  authorAssociation: string;
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

  if (MANUAL_TRIGGER_AUTHORS.has(author)) {
    return {
      action: "wait",
      reason: `Dependency PR: comment ${TEST_COMMAND} when it is ready to merge`,
    };
  }

  const trusted =
    TRUSTED_ASSOCIATIONS.has(authorAssociation) ||
    labels.includes(OK_TO_TEST_LABEL);
  if (!trusted) {
    return {
      action: "wait",
      reason: `Needs /ok-to-test from a member, then ${TEST_COMMAND}`,
    };
  }

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
        reason: `Image build was skipped ([skip-build]); comment ${TEST_COMMAND} to override`,
      };
    }
  } else if (input.publishResult !== "success") {
    return {
      action: "fail",
      reason: "PR image was built but could not be published",
    };
  }

  // Prow never auto-ran presubmits on drafts. Marking the PR ready for review
  // re-runs the image build and this gate.
  if (input.draft) {
    return {
      action: "wait",
      reason: `Draft PR: mark it ready for review, or comment ${TEST_COMMAND}`,
    };
  }

  return {
    action: "run",
    reason: "Running e2e-ocp-helm on an ephemeral OCP cluster",
  };
}
