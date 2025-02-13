#!/bin/bash

source ../install-methods/operator.sh

initiate_operator_deployments() {
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  
  configure_namespace "${NAME_SPACE}"
  deploy_test_backstage_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"

  configure_namespace "${NAME_SPACE_RBAC}"
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"
}

handle_ocp_operator() {
  oc_login

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local rbac_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_ocp_operator
  initiate_operator_deployments
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
}
