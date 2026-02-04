#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_ocp_nightly() {
  export NAME_SPACE="${NAME_SPACE:-showcase-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-nightly}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db-nightly}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  # Use OSD-GCP specific deployment for osd-gcp jobs (orchestrator disabled)
  if [[ "${JOB_NAME}" =~ osd-gcp ]]; then
    log::info "Detected OSD-GCP job, using OSD-GCP specific deployment (orchestrator disabled)"
    initiate_deployments_osd_gcp
  else
    initiate_deployments
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
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  initiate_runtime_deployment "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" "${runtime_url}"
}

run_sanity_plugins_check() {
  local sanity_plugins_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_sanity_plugin_checks_deployment "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}" "${sanity_plugins_url}"
}
