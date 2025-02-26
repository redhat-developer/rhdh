#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

initiate_aks_operator_deployment() {
  local name_space=$1
  local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"

  configure_namespace "${name_space}"
  # deploy_test_backstage_customization_provider "${name_space}" # Doesn't work on K8S
  apply_yaml_files "${DIR}" "${name_space}" "${rhdh_base_url}"

  # Create a ConfigMap for dynamic plugins
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_AKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  create_dynamic_plugins_config "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  mkdir -p "${ARTIFACT_DIR}/${name_space}"
  cp -a "/tmp/configmap-dynamic-plugins.yaml" "${ARTIFACT_DIR}/${name_space}/" # Save the final value-file into the artifacts directory.
  kubectl apply -f /tmp/configmap-dynamic-plugins.yaml -n "${name_space}"

  kubectl apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${name_space}"
  setup_image_pull_secret "${name_space}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  deploy_rhdh_operator "${name_space}" "${DIR}/resources/rhdh-operator/rhdh-start_K8s.yaml"

  apply_aks_operator_ingress backstage-rhdh "$name_space"
}

initiate_rbac_aks_operator_deployment() {
  local name_space=$1
  local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"

  configure_namespace "${name_space}"
  # deploy_test_backstage_customization_provider "${name_space}" # Doesn't work on K8S
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  apply_yaml_files "${DIR}" "${name_space}" "${rhdh_base_url}"

  # Create a ConfigMap for dynamic plugins
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_AKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  create_dynamic_plugins_config "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  mkdir -p "${ARTIFACT_DIR}/${name_space}"
  cp -a "/tmp/configmap-dynamic-plugins-rbac.yaml" "${ARTIFACT_DIR}/${name_space}/" # Save the final value-file into the artifacts directory.
  kubectl apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${name_space}"

  setup_image_pull_secret "${name_space}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  deploy_rhdh_operator "${name_space}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac_K8s.yaml"

  apply_aks_operator_ingress backstage-rhdh-rbac "$name_space"
}

apply_aks_operator_ingress() {
  local service_name=$1
  local name_space=$2
  cat "$DIR/cluster/aks/manifest/aks-operator-ingress.yaml" | \
    yq ".spec.rules[0].http.paths[0].backend.service.name = \"$service_name\"" - | \
    kubectl apply --namespace="${name_space}" -f -
}

cleanup_aks_deployment() {
  local name_space=$1
  delete_namespace "$name_space"
}