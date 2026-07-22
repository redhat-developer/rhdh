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
  # Runtime tests self-deploy from Playwright global setup when
  # RUNTIME_AUTO_DEPLOY=true. Pass the predicted route as BASE_URL so
  # playwright.config.ts freezes a usable use.baseURL before globalSetup
  # (Playwright resolves config before globalSetup runs). globalSetup then
  # deploys via ensureRuntimeDeployed() and healthchecks that URL.
  # Subsequent test files reuse the existing deployment (workers: 1).
  #
  # Scope RUNTIME_AUTO_DEPLOY to this invocation only — a lasting export would
  # leak into later projects (e.g. sanity-plugins) and stomp BASE_URL.

  export INSTALL_METHOD="helm"
  local runtime_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  RUNTIME_AUTO_DEPLOY=true testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" "${runtime_url}" || true
}

run_sanity_plugins_check() {
  local sanity_plugins_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_sanity_plugin_checks_deployment "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}" "${sanity_plugins_url}"
}
