import { execFile as execFileCb } from "child_process";
import fs from "fs";

import { type Page, type Locator } from "@playwright/test";

import {
  BACKSTAGE_DEPLOY_SELECTOR,
  type JobNamePattern,
  type JobNameRegexPattern,
  type JobTypePattern,
  type IsOpenShiftValue,
} from "./constants";

function execFileAsync(
  cmd: string,
  args: string[],
  options: { maxBuffer?: number; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, options, (error, stdout, stderr) => {
      if (error !== null) {
        const err = error instanceof Error ? error : new Error(`execFile failed: ${cmd}`);
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function downloadAndReadFile(
  page: Page,
  locator: Locator,
): Promise<string | undefined> {
  const [download] = await Promise.all([page.waitForEvent("download"), locator.click()]);

  const filePath = await download.path();

  if (filePath) {
    return fs.readFileSync(filePath, "utf-8");
  }
  console.error("Download failed or path is not available");
  return undefined;
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
export function skipIfJobNameRegex(jobNameRegexPattern: JobNameRegexPattern): boolean {
  const jobName = process.env.JOB_NAME;
  if (jobName === undefined || jobName === "") {
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

/**
 * Canonical install method detection. Checks INSTALL_METHOD env var first,
 * falls back to JOB_NAME pattern matching.
 */
export function resolveInstallMethod(): "helm" | "operator" {
  if (process.env.INSTALL_METHOD === "operator") return "operator";
  if (process.env.INSTALL_METHOD === "helm") return "helm";
  const job = process.env.JOB_NAME ?? "";
  return job.includes("operator") ? "operator" : "helm";
}

/**
 * Canonical release name resolution. Returns the RELEASE_NAME env var if set
 * and non-empty, otherwise defaults to "rhdh".
 *
 * Note: the explicit check is used instead of `||` because oxlint's
 * strict-boolean-expressions and prefer-nullish-coalescing rules
 * (pedantic category) reject `||` on string operands.
 */
export function getReleaseName(): string {
  return process.env.RELEASE_NAME !== undefined && process.env.RELEASE_NAME !== ""
    ? process.env.RELEASE_NAME
    : "rhdh";
}

/** Base64-encode a string. */
export function base64Encode(value: string): string {
  return Buffer.from(value).toString("base64");
}

/** Base64-decode a string. */
export function base64Decode(value: string): string {
  return Buffer.from(value, "base64").toString("utf-8");
}

/**
 * Returns whether the current job is an Operator deployment.
 */
export function isOperatorDeployment(): boolean {
  return resolveInstallMethod() === "operator";
}

/**
 * Returns the deployment-level label selector for the backstage Deployment.
 * Works with `oc get deploy -l` or `listNamespacedDeployment` to resolve the
 * deployment, then target pods via `oc logs deployment/<name>`.
 *
 * Generalizes the auth-providers pattern from rhdh-deployment.ts which queries
 * deployments (not pods) by `app.kubernetes.io/name` + `app.kubernetes.io/instance`.
 *
 * @returns The appropriate deployment label selector string
 */
export function getBackstageDeploySelector(): string {
  return isOperatorDeployment()
    ? BACKSTAGE_DEPLOY_SELECTOR.OPERATOR
    : BACKSTAGE_DEPLOY_SELECTOR.HELM;
}

// ─── Shell command execution ─────────────────────────────────────────────────

/**
 * Run a shell command and return stdout. Throws on non-zero exit.
 */
export async function run(
  cmd: string,
  args: string[],
  options?: { timeout?: number },
): Promise<string> {
  const timeout = options?.timeout ?? 300_000;
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout,
  });
  if (stderr) {
    // Helm and oc print warnings to stderr that are not errors
    for (const line of stderr.split("\n").filter(Boolean)) {
      console.log(`  (stderr) ${line}`);
    }
  }
  return stdout.trim();
}

// ─── OpenShift cluster discovery ─────────────────────────────────────────────

/**
 * Discover the cluster router base from the OpenShift console route.
 * Falls back to K8S_CLUSTER_ROUTER_BASE env var if set.
 */
export async function discoverRouterBase(): Promise<string> {
  try {
    const output = await run("oc", [
      "get",
      "route",
      "console",
      "-n",
      "openshift-console",
      "-o",
      "jsonpath={.spec.host}",
    ]);
    return output.replace(/^console-openshift-console\./u, "");
  } catch {
    throw new Error("K8S_CLUSTER_ROUTER_BASE not set and could not discover from cluster");
  }
}

// ─── Image reference utilities ───────────────────────────────────────────────

/** Parsed image reference with registry, repository, and tag or digest. */
export interface ImageRef {
  registry: string;
  repository: string;
  /** Tag value (e.g. "1.10") or digest (e.g. "sha256:abc123"). */
  tag: string;
  /** ":" for tag references, "@" for digest references. */
  separator: ":" | "@";
}

/** Reconstruct a full image reference from its parsed components. */
export function imageRefToString(ref: ImageRef): string {
  return `${ref.registry}/${ref.repository}${ref.separator}${ref.tag}`;
}

/**
 * Build an ImageRef from individual registry, repository, and tag/digest values.
 * Detects digest references (tag starting with "sha256:") and sets the
 * separator accordingly.
 */
export function buildImageRef(registry: string, repository: string, tag: string): ImageRef {
  return {
    registry,
    repository,
    tag,
    separator: tag.startsWith("sha256:") ? "@" : ":",
  };
}

/**
 * Decompose a full image reference into registry / repository / tag.
 *
 * Handles both tag references (quay.io/rhdh/image:1.10) and digest
 * references (quay.io/rhdh/image@sha256:abc123).
 */
export function parseCatalogIndexImage(imageRef: string): ImageRef {
  // Handle @sha256: digest references (e.g. quay.io/rhdh/image@sha256:abc123)
  const atIdx = imageRef.indexOf("@");
  if (atIdx !== -1) {
    const digest = imageRef.slice(atIdx + 1);
    const withoutDigest = imageRef.slice(0, atIdx);
    const slashIdx = withoutDigest.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(`Invalid CATALOG_INDEX_IMAGE (no registry separator '/'): ${imageRef}`);
    }
    return {
      registry: withoutDigest.slice(0, slashIdx),
      repository: withoutDigest.slice(slashIdx + 1),
      tag: digest,
      separator: "@",
    };
  }

  // Handle tag references (e.g. quay.io/rhdh/image:1.10)
  const colonIdx = imageRef.lastIndexOf(":");
  if (colonIdx === -1) {
    throw new Error(`Invalid CATALOG_INDEX_IMAGE (no tag separator ':'): ${imageRef}`);
  }
  const tag = imageRef.slice(colonIdx + 1);
  const withoutTag = imageRef.slice(0, colonIdx);
  const slashIdx = withoutTag.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Invalid CATALOG_INDEX_IMAGE (no registry separator '/'): ${imageRef}`);
  }
  return {
    registry: withoutTag.slice(0, slashIdx),
    repository: withoutTag.slice(slashIdx + 1),
    tag,
    separator: ":",
  };
}
