#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

handle_ocp_nightly() {
  export NAME_SPACE="showcase-ci-nightly"
  export NAME_SPACE_RBAC="showcase-rbac-nightly"
  export NAME_SPACE_POSTGRES_DB="postgress-external-db-nightly"

  oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm
  clear_database
  initiate_deployments
  deploy_test_backstage_customization_provider "${NAME_SPACE}"

  run_standard_deployment_tests
  run_runtime_config_change_tests
  run_sanity_plugins_check

}

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
}

run_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  initiate_runtime_deployment "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${runtime_url}"
}

run_sanity_plugins_check() {
  local sanity_plugins_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_sanity_plugin_checks_deployment "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}"
}
