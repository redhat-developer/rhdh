#!/bin/bash

initiate_gke_operator_deployment() {
  gcloud_ssl_cert_create $GKE_CERT_NAME $GKE_INSTANCE_DOMAIN_NAME $GOOGLE_CLOUD_PROJECT

  # configure_namespace "${OPERATOR_MANAGER}"
  # install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml

  configure_namespace "${NAME_SPACE}"
  # deploy_test_backstage_provider "${NAME_SPACE}" # Doesn't work on K8S
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE}"
  deploy_rhdh_operator "${DIR}" "${NAME_SPACE}"

  # add_helm_repos
  # delete_namespace "${NAME_SPACE_RBAC_K8S}"
  # configure_namespace "${NAME_SPACE_K8S}"
  # uninstall_helmchart "${NAME_SPACE_K8S}" "${RELEASE_NAME}"
  # cd "${DIR}" || exit
  # local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  # apply_yaml_files "${DIR}" "${NAME_SPACE_K8S}" "${rhdh_base_url}"
  # oc apply -f "${DIR}/cluster/gke/frontend-config.yaml" --namespace="${project}"
  # yq_merge_value_files "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_GKE_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  # mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_K8S}"
  # cp -a "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${NAME_SPACE_K8S}/" # Save the final value-file into the artifacts directory.
  # echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_K8S}"
  # helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE_K8S}" \
  #   "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
  #   -f "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" \
  #   --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
  #   --set upstream.backstage.image.repository="${QUAY_REPO}" \
  #   --set upstream.backstage.image.tag="${TAG_NAME}" \
  #   --set upstream.ingress.annotations."ingress\.gcp\.kubernetes\.io/pre-shared-cert"="${GKE_CERT_NAME}"
}

initiate_rbac_gke_operator_deployment() {
  gcloud_ssl_cert_create $GKE_CERT_NAME $GKE_INSTANCE_DOMAIN_NAME $GOOGLE_CLOUD_PROJECT
  
#   add_helm_repos
#   delete_namespace "${NAME_SPACE_K8S}"
#   configure_namespace "${NAME_SPACE_RBAC_K8S}"
#   uninstall_helmchart "${NAME_SPACE_RBAC_K8S}" "${RELEASE_NAME_RBAC}"
#   cd "${DIR}" || exit
#   local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
#   apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC_K8S}"  "${rbac_rhdh_base_url}"
#   yq_merge_value_files "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_GKE_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}"
#   mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC_K8S}"
#   cp -a "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC_K8S}/" # Save the final value-file into the artifacts directory.
#   echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_RBAC_K8S}"
#   helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC_K8S}" \
#     "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
#     -f "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}" \
#     --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
#     --set upstream.backstage.image.repository="${QUAY_REPO}" \
#     --set upstream.backstage.image.tag="${TAG_NAME}" \
#     --set upstream.ingress.annotations."ingress\.gcp\.kubernetes\.io/pre-shared-cert"="${GKE_CERT_NAME}"
}
