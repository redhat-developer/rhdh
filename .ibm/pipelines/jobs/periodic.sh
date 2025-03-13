#!/bin/bash

handle_nightly() {
  export NAME_SPACE="showcase-ci-nightly"
  export NAME_SPACE_RBAC="showcase-rbac-nightly"
  export NAME_SPACE_POSTGRES_DB="postgress-external-db-nightly"
  export NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  export NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"

  oc_login

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')

  cluster_setup
  initiate_deployments
#  deploy_test_backstage_provider "${NAME_SPACE}"

#  run_standard_deployment_tests
  run_runtime_config_change_tests
#  run_sanity_plugins_check

}

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-backstage-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-backstage-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
}

run_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  local original_helm_chart_value_file_name="${HELM_CHART_VALUE_FILE_NAME}"
  export HELM_CHART_VALUE_FILE_NAME="values_showcase_simple.yaml"
  initiate_runtime_deployment "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://${RELEASE_NAME}-backstage-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${runtime_url}"
  export HELM_CHART_VALUE_FILE_NAME="${original_helm_chart_value_file_name}" # restoring to the original value
}

run_sanity_plugins_check() {
  initiate_sanity_plugin_checks_deployment "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}"
  local sanity_plugins_url="https://${RELEASE_NAME}-backstage-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}"
}
