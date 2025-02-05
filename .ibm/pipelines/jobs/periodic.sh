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
  run_sanity_plugins_check
  deploy_test_backstage_provider "${NAME_SPACE}"

  run_standard_deployment_tests
  run_sanity_plugins_check
  run_rds_deployment_tests
#  run_runtime_config_change_tests

}

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-backstage-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-backstage-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
}

run_rds_deployment_tests() {
  # Only test TLS config with RDS and Change configuration at runtime in nightly jobs
  initiate_rds_deployment "${RELEASE_NAME}" "${NAME_SPACE_RDS}"
  local rds_url="https://${RELEASE_NAME}-backstage-${NAME_SPACE_RDS}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RDS}" "${rds_url}"
}

run_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  configure_namespace "${NAME_SPACE_RUNTIME}"
  uninstall_helmchart "${NAME_SPACE_RUNTIME}" "${RELEASE_NAME}"
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE_RUNTIME}"

  local runtime_url="https://${RELEASE_NAME}-backstage-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"

  apply_yaml_files "${DIR}" "${NAME_SPACE_RUNTIME}" "${runtime_url}"
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE_RUNTIME}" \
    "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
    -f "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \

  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${runtime_url}"
}

run_sanity_plugins_check() {
  configure_namespace "${NAME_SPACE_SANITY_PLUGINS_CHECK}"
  uninstall_helmchart "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${RELEASE_NAME}"
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE_SANITY_PLUGINS_CHECK}"
  local sanity_plugins_url="https://${RELEASE_NAME}-backstage-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}"

  helm upgrade -i "${RELEASE_NAME}" \
     -n "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" \
     --version "${CHART_VERSION}" \
     -f "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" \
     -f "${DIR}/value_files/sanity-check-plugins.yaml" \
     --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
     --set upstream.backstage.image.repository="${QUAY_REPO}" \
     --set upstream.backstage.image.tag="${TAG_NAME}"

  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}"
}
