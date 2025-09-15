#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/k8s/k8s-utils.sh
source "$DIR"/cluster/k8s/k8s-utils.sh

initiate_aks_helm_deployment() {
  delete_namespace "${NAME_SPACE_RBAC}"
  configure_namespace "${NAME_SPACE}"

  deploy_redis_cache "${NAME_SPACE}"
  patch_and_restart "$NAME_SPACE" "deployment" "redis" "${DIR}/cluster/aks/patch/aks-spot-patch.yaml" # Patch Redis deployment to run on spot cluster

  uninstall_helmchart "${NAME_SPACE}" "${RELEASE_NAME}"

  cd "${DIR}" || exit
  local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_AKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE}"
  cp -a "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${NAME_SPACE}/" # Save the final value-file into the artifacts directory.

  setup_image_pull_secret "${NAME_SPACE}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" \
    --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}"
}

initiate_rbac_aks_helm_deployment() {
  delete_namespace "${NAME_SPACE}"
  configure_namespace "${NAME_SPACE_RBAC}"

  uninstall_helmchart "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}"

  cd "${DIR}" || exit
  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_AKS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
  cp -a "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" # Save the final value-file into the artifacts directory.

  setup_image_pull_secret "${NAME_SPACE_RBAC}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_RBAC}"
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}" \
    --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}"
}
