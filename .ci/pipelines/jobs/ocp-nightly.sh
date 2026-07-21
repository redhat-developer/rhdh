#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/schema-mode-env.sh
source "$DIR"/lib/schema-mode-env.sh

handle_ocp_nightly() {
  export NAME_SPACE="${NAME_SPACE:-showcase-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-nightly}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db-nightly}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  if [[ "${JOB_NAME}" == *osd-gcp* ]]; then
    log::info "Detected OSD-GCP job, using OSD-GCP specific deployment"
    initiate_deployments_osd_gcp "${PW_PROJECT_SHOWCASE}" "${PW_PROJECT_SHOWCASE_RBAC}"
  else
    initiate_deployments "${PW_PROJECT_SHOWCASE}" "${PW_PROJECT_SHOWCASE_RBAC}"
  fi

  deploy_test_backstage_customization_provider "${NAME_SPACE}"

  run_standard_deployment_tests
  run_runtime_config_change_tests
  run_sanity_plugins_check
}

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC}" "${rbac_url}"
}

run_runtime_config_change_tests() {
  # Runtime tests handle their own deployment via TypeScript (runtime-deploy.ts).
  # The first test file (config-map.spec.ts) calls ensureRuntimeDeployed() which:
  #   - Creates the namespace
  #   - Deploys RHDH with Helm + internal PostgreSQL sub-chart
  #   - Configures schema-mode env vars for port-forwarding
  # Subsequent test files reuse the existing deployment (workers: 1).
  #
  # The CI wrapper only needs to set environment variables and invoke Playwright.
  #
  # No URL is passed on purpose. run_tests exports whatever it gets as BASE_URL,
  # and global-setup.ts only deploys when BASE_URL is EMPTY and
  # RUNTIME_AUTO_DEPLOY is true. Passing the route pre-set BASE_URL, so the
  # deploy branch was skipped and global-setup instead polled a route that
  # nothing had created yet - failing after 120s before any test could run.
  # ensureRuntimeDeployed() sets BASE_URL itself once the route exists.
  export INSTALL_METHOD="helm"
  export RUNTIME_AUTO_DEPLOY="true"
  testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" || true
}

run_sanity_plugins_check() {
  local sanity_plugins_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_sanity_plugin_checks_deployment "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}" "${sanity_plugins_url}"
  # Name the culprit plugin(s) loudly when the deployment or tests failed -
  # a broken plugin takes the whole pod down, and the answer is buried in the
  # pod logs otherwise. Advisory: prints nothing fatal on healthy runs.
  testing::report_plugin_startup_failures "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}"

  # Cluster-free counterpart (RHIDP-13508): boots packages/backend from source
  # inside the test pod with EVERY plugin the catalog index declares and
  # verifies the product's dynamic plugin loader loaded all of them. The
  # cluster deployment above validates the curated plugin set on the shipped
  # image; this validates the full index composition against the current
  # backend line. The function records its own result via test_run_tracker and
  # save_overall_result (like testing::run_tests), so a failure here marks the
  # job without aborting remaining steps.
  testing::run_plugin_sanity_check "plugin-dynamic-loading" || true
}
