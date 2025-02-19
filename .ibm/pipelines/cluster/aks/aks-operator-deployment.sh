#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

initiate_aks_operator_deployment() {
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml

  configure_namespace "${NAME_SPACE}"
  # deploy_test_backstage_provider "${NAME_SPACE}" # Doesn't work on K8S
  local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  # Create a ConfigMap for dynamic plugins
  yq_merge_value_files "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_AKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  create_dynamic_plugins_config "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_K8S}"
  cp -a "/tmp/configmap-dynamic-plugins.yaml" "${ARTIFACT_DIR}/${NAME_SPACE_K8S}/" # Save the final value-file into the artifacts directory.
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"

  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE}"
  setup_image_pull_secret "${NAME_SPACE}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start_AKS.yaml"

  operation_aks_operator_ingress create "$NAME_SPACE"



}

initiate_rbac_aks_operator_deployment() {  
  delete_namespace "${NAME_SPACE_K8S}"
}

operation_aks_operator_ingress() {
  local operation=$1
  local name_space=$2
  kubectl $operation -f "$DIR/cluster/aks/manifest/aks-operator-ingress.yaml" --namespace="${name_space}"
}

cleanup_aks_deployment() {
  local name_space=$
  operation_aks_operator_ingress delete "$name_space"
}