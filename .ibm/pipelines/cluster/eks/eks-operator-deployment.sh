#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

initiate_eks_operator_deployment() {
  local namespace=$1
  local rhdh_base_url=$2

  echo "Initiating Operator-backed non-RBAC deployment on EKS"

  configure_namespace "${namespace}"
  deploy_redis_cache "${namespace}"
  # deploy_test_backstage_customization_provider "${namespace}" # Doesn't work on K8s
  apply_yaml_files "${DIR}" "${namespace}" "${rhdh_base_url}"

  echo "Creating and applying ConfigMap for dynamic plugins"
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_EKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  create_dynamic_plugins_config "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "/tmp/configmap-dynamic-plugins.yaml" "${ARTIFACT_DIR}/${namespace}/" # Save the final value-file into the artifacts directory.
  kubectl apply -f /tmp/configmap-dynamic-plugins.yaml -n "${namespace}"

  setup_image_pull_secret "${namespace}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  deploy_rhdh_operator "${namespace}" "${DIR}/resources/rhdh-operator/rhdh-start_K8s.yaml"

  apply_eks_operator_ingress "$namespace" "backstage-$RELEASE_NAME"
}

initiate_rbac_eks_operator_deployment() {
  local namespace=$1
  local rhdh_base_url=$2

  echo "Initiating Operator-backed RBAC deployment on EKS"

  configure_namespace "${namespace}"
  # deploy_test_backstage_customization_provider "${namespace}" # Doesn't work on K8s
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  apply_yaml_files "${DIR}" "${namespace}" "${rhdh_base_url}"

  echo "Creating and applying ConfigMap for dynamic plugins"
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_EKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  create_dynamic_plugins_config "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "/tmp/configmap-dynamic-plugins-rbac.yaml" "${ARTIFACT_DIR}/${namespace}/" # Save the final value-file into the artifacts directory.
  kubectl apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${namespace}"

  setup_image_pull_secret "${namespace}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  deploy_rhdh_operator "${namespace}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac_K8s.yaml"

  apply_eks_operator_ingress "$namespace" "backstage-$RELEASE_NAME_RBAC"
}

apply_eks_operator_ingress() {
  local namespace=$1
  local service_name=$2
  envsubst < "$DIR/cluster/eks/manifest/eks-operator-ingress.yaml" \
    | yq ".spec.rules[0].http.paths[0].backend.service.name = \"$service_name\"" - \
    | kubectl apply --namespace="${namespace}" -f -
}

cleanup_eks_deployment() {
  local namespace=$1
  delete_namespace "$namespace"
}
