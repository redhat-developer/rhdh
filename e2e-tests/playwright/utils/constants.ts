export const NO_USER_FOUND_IN_CATALOG_ERROR_MESSAGE =
  /Login failed; caused by Error: Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver./u;

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

export type JobNamePattern = (typeof JOB_NAME_PATTERNS)[keyof typeof JOB_NAME_PATTERNS];

/**
 * Kubernetes deployment-level label selectors for backstage.
 * Both Helm and Operator set `app.kubernetes.io/name` on Deployment metadata
 * (but with different values). Use these to resolve the deployment, then
 * target pods via `oc logs deployment/<name>` or `listNamespacedDeployment`.
 *
 * @see https://github.com/redhat-developer/rhdh-operator/blob/main/pkg/utils/utils.go
 */
export const BACKSTAGE_DEPLOY_SELECTOR = {
  HELM: "app.kubernetes.io/component=backstage,app.kubernetes.io/name=developer-hub",
  OPERATOR: "app.kubernetes.io/name=backstage",
} as const;
