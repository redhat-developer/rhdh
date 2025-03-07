#!/bin/bash

install_rhdh_operator() {
  local dir=$1
  local namespace=$2

  configure_namespace $namespace

  # Make sure script is up to date
  rm -f /tmp/install-rhdh-catalog-source.sh
  curl -L "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh" > /tmp/install-rhdh-catalog-source.sh
  chmod +x /tmp/install-rhdh-catalog-source.sh
  if [ "$RELEASE_BRANCH_NAME" == "main" ]; then
    echo "Installing RHDH operator with '--next' flag"
    bash -x /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh
  else
    local operator_version="${RELEASE_BRANCH_NAME#release-}"
    echo "Installing RHDH operator with '-v $operator_version' flag"
    bash -x /tmp/install-rhdh-catalog-source.sh -v "$operator_version" --install-operator rhdh
  fi
}

deploy_rhdh_operator() {
  local dir=$1
  local namespace=$2

  timeout 300 bash -c '
    while ! oc get crd/backstages.rhdh.redhat.com -n "${namespace}" >/dev/null 2>&1; do
        echo "Waiting for Backstage CRD to be created..."
        sleep 20
    done
    echo "Backstage CRD is created."
    ' || echo "Error: Timed out waiting for Backstage CRD creation."

  if [[ "${namespace}" == "showcase-op-rbac-nightly" ]]; then
    oc apply -f "${dir}/resources/rhdh-operator/rhdh-start-rbac.yaml" -n "${namespace}"
  else
    oc apply -f "${dir}/resources/rhdh-operator/rhdh-start.yaml" -n "${namespace}"
  fi
}

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
  deploy_rhdh_operator "${DIR}" "${NAME_SPACE}"

  configure_namespace "${NAME_SPACE_RBAC}"
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  deploy_rhdh_operator "${DIR}" "${NAME_SPACE_RBAC}"
}

handle_operator() {
  oc_login

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local rbac_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_operator
  initiate_operator_deployments
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
}
