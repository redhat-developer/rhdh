export const GITHUB_URL = "https://github.com/";
export const JANUS_ORG = "janus-idp";
export const JANUS_QE_ORG = "janus-qe";
export const SHOWCASE_REPO = `${JANUS_ORG}/backstage-showcase`;
export const CATALOG_FILE = "catalog-info.yaml";
export const NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE =
  /Login failed; caused by Error: Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver./;

/**
 * CI/CD Environment variable patterns used for conditional test execution
 * Based on OpenShift CI and Prow environment variables
 * @see https://docs.ci.openshift.org/docs/architecture/step-registry/#available-environment-variables
 * @see https://docs.prow.k8s.io/docs/jobs/#job-environment-variables
 */

/**
 * JOB_NAME patterns - identifies specific job configurations
 * Examples: "periodic-ci-redhat-developer-rhdh-main-e2e-osd-gcp-helm-nightly"
 * @see https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh
 */
export const JOB_NAME_PATTERNS = {
  AKS: "aks",
  EKS: "eks",
  GKE: "gke",
  OSD_GCP: "osd-gcp",
  HELM: "helm",
  OPERATOR: "operator",
  NIGHTLY: "nightly",
} as const;

/**
 * JOB_NAME regex patterns - for flexible pattern matching (e.g., OCP versions)
 * Use these with skipIfJobNameRegex() function
 */
export const JOB_NAME_REGEX_PATTERNS = {
  /**
   * Matches OCP version patterns like "ocp-v4.15-*", "ocp-v4.16-*", etc.
   * Example: "periodic-ci-redhat-developer-rhdh-main-e2e-ocp-v4.15-helm-nightly"
   */
  OCP_VERSION: /ocp-v\d+-\d+/,
} as const;

/**
 * JOB_TYPE patterns - identifies job execution type
 * Examples: "presubmit", "periodic", "postsubmit"
 */
export const JOB_TYPE_PATTERNS = {
  PRESUBMIT: "presubmit",
  PERIODIC: "periodic",
} as const;

/**
 * IS_OPENSHIFT values - identifies if running on OpenShift
 * Note: IS_OPENSHIFT is a custom project variable (different from OPENSHIFT_CI).
 * It is set in the CI scripts for specific jobs. This is a boolean string, not a pattern.
 */
export const IS_OPENSHIFT_VALUES = {
  TRUE: "true",
  FALSE: "false",
} as const;

export type JobNamePattern =
  (typeof JOB_NAME_PATTERNS)[keyof typeof JOB_NAME_PATTERNS];
export type JobNameRegexPattern =
  (typeof JOB_NAME_REGEX_PATTERNS)[keyof typeof JOB_NAME_REGEX_PATTERNS];
export type JobTypePattern =
  (typeof JOB_TYPE_PATTERNS)[keyof typeof JOB_TYPE_PATTERNS];
export type IsOpenShiftValue =
  (typeof IS_OPENSHIFT_VALUES)[keyof typeof IS_OPENSHIFT_VALUES];
