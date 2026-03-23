import { type Page, type Locator } from "@playwright/test";
import fs from "fs";
import type {
  JobNamePattern,
  JobNameRegexPattern,
  JobTypePattern,
  IsOpenShiftValue,
} from "./constants";

export async function downloadAndReadFile(
  page: Page,
  locator: Locator,
): Promise<string | undefined> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    locator.click(),
  ]);

  const filePath = await download.path();

  if (filePath) {
    return fs.readFileSync(filePath, "utf-8");
  } else {
    console.error("Download failed or path is not available");
    return undefined;
  }
}

/**
 * Helper function to skip tests based on JOB_NAME environment variable
 * Use this to detect specific job configurations (e.g., "osd-gcp", "helm", "operator", "nightly")
 *
 * @param jobNamePattern - Pattern to match in JOB_NAME (use JOB_NAME_PATTERNS constants)
 * @returns boolean - true if test should be skipped
 *
 * @example
 * import { JOB_NAME_PATTERNS } from "./constants";
 * test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP));
 *
 * @see https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh
 */
export function skipIfJobName(jobNamePattern: JobNamePattern): boolean {
  return process.env.JOB_NAME?.includes(jobNamePattern) ?? false;
}

/**
 * Helper function to skip tests based on JOB_NAME environment variable using regex patterns
 * Use this for flexible pattern matching (e.g., OCP version patterns like "ocp-v4.15-*")
 *
 * @param jobNameRegexPattern - Regex pattern to match in JOB_NAME (use JOB_NAME_REGEX_PATTERNS constants)
 * @returns boolean - true if test should be skipped
 *
 * @example
 * import { JOB_NAME_REGEX_PATTERNS } from "./constants";
 * // Skip if running on any OCP version (e.g., ocp-v4.15-*, ocp-v4.16-*)
 * test.skip(() => skipIfJobNameRegex(JOB_NAME_REGEX_PATTERNS.OCP_VERSION));
 *
 * @see https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh
 */
export function skipIfJobNameRegex(
  jobNameRegexPattern: JobNameRegexPattern,
): boolean {
  const jobName = process.env.JOB_NAME;
  if (!jobName) {
    return false;
  }
  return jobNameRegexPattern.test(jobName);
}

/**
 * Helper function to skip tests based on JOB_TYPE environment variable
 * Use this to detect job execution type (e.g., "presubmit", "periodic", "postsubmit")
 *
 * @param jobTypePattern - Pattern to match in JOB_TYPE (use JOB_TYPE_PATTERNS constants)
 * @returns boolean - true if test should be skipped
 *
 * @example
 * import { JOB_TYPE_PATTERNS } from "./constants";
 * test.skip(() => skipIfJobType(JOB_TYPE_PATTERNS.PRESUBMIT));
 *
 * @see https://docs.prow.k8s.io/docs/jobs/#job-environment-variables
 */
export function skipIfJobType(jobTypePattern: JobTypePattern): boolean {
  return process.env.JOB_TYPE?.includes(jobTypePattern) ?? false;
}

/**
 * Helper function to skip tests based on IS_OPENSHIFT environment variable
 * Use this to detect if running on OpenShift vs other platforms (e.g., AKS, EKS, GKE)
 *
 * Note: IS_OPENSHIFT is a custom project variable (different from OPENSHIFT_CI).
 * It is set in the CI scripts for specific jobs (e.g., OSD-GCP is OpenShift but doesn't have "ocp" in its JOB_NAME).
 *
 * @param isOpenShiftValue - Value to match IS_OPENSHIFT against (use IS_OPENSHIFT_VALUES constants)
 * @returns boolean - true if test should be skipped
 *
 * @example
 * import { IS_OPENSHIFT_VALUES } from "./constants";
 * // Skip if running on OpenShift
 * test.skip(() => skipIfIsOpenShift(IS_OPENSHIFT_VALUES.TRUE));
 * // Skip if NOT running on OpenShift
 * test.skip(() => skipIfIsOpenShift(IS_OPENSHIFT_VALUES.FALSE));
 */
export function skipIfIsOpenShift(isOpenShiftValue: IsOpenShiftValue): boolean {
  return process.env.IS_OPENSHIFT === isOpenShiftValue;
}
