#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

initiate_operator_deployments() {
  echo "Initiating Operator-backed deployments on OCP"

  prepare_operator

  configure_namespace "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"
  enable_orchestrator_plugins_op "${NAME_SPACE}"
  deploy_orchestrator_workflows_operator "${NAME_SPACE}"

  configure_namespace "${NAME_SPACE_RBAC}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"
  enable_orchestrator_plugins_op "${NAME_SPACE_RBAC}"
  deploy_orchestrator_workflows_operator "${NAME_SPACE_RBAC}"
}

run_operator_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  configure_namespace "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  sed -i "s|POSTGRES_USER:.*|POSTGRES_USER: $RDS_USER|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: $(echo -n "$RDS_PASSWORD" | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_HOST:.*|POSTGRES_HOST: $(echo -n "$RDS_1_HOST" | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|RHDH_RUNTIME_URL:.*|RHDH_RUNTIME_URL: $(echo -n "$runtime_url" | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "$DIR/resources/postgres-db/postgres-crt-rds.yaml" -n "${NAME_SPACE_RUNTIME}"
  oc apply -f "$DIR/resources/postgres-db/postgres-cred.yaml" -n "${NAME_SPACE_RUNTIME}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${NAME_SPACE_RUNTIME}"
  create_app_config_map "$DIR/resources/postgres-db/rds-app-config.yaml" "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  deploy_rhdh_operator "${NAME_SPACE_RUNTIME}" "${DIR}/resources/rhdh-operator/rhdh-start-runtime.yaml"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${runtime_url}"
}

handle_ocp_operator() {
  oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE
  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local rbac_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_ocp_operator
  initiate_operator_deployments
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"

  run_operator_runtime_config_change_tests
}
