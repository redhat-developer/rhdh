initiate_gke_deployment() {
  gcloud_ssl_cert_create $GKE_CERT_NAME $GKE_INSTANCE_DOMAIN_NAME $GOOGLE_CLOUD_PROJECT
  add_helm_repos
  install_helm
  delete_namespace "${NAME_SPACE_RBAC_AKS}"
  configure_namespace "${NAME_SPACE_AKS}"
  # Renable when namespace termination issue is solved
  # install_tekton_pipelines
  uninstall_helmchart "${NAME_SPACE_AKS}" "${RELEASE_NAME}"
  cd "${DIR}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_AKS}"
  oc apply -f "${DIR}/cluster/gke/frontend-config.yaml" --namespace="${project}"
  yq_merge_value_files "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_GKE_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_GKE_MERGED_VALUE_FILE_NAME}"
  cp -a "/tmp/${HELM_CHART_GKE_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${NAME_SPACE_AKS}" # Save the final value-file into the artifacts directory.
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_AKS}"
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE_AKS}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_GKE_MERGED_VALUE_FILE_NAME}" \
    --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \
    --set upstream.ingress.annotations."ingress\.gcp\.kubernetes\.io/pre-shared-cert"="${GKE_CERT_NAME}"
}

initiate_rbac_gke_deployment() {
  gcloud_ssl_cert_create $GKE_CERT_NAME $GKE_INSTANCE_DOMAIN_NAME $GOOGLE_CLOUD_PROJECT
  add_helm_repos
  install_helm
  delete_namespace "${NAME_SPACE_AKS}"
  configure_namespace "${NAME_SPACE_RBAC_AKS}"
  # Renable when namespace termination issue is solved
  # install_tekton_pipelines
  uninstall_helmchart "${NAME_SPACE_RBAC_AKS}" "${RELEASE_NAME_RBAC}"
  cd "${DIR}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC_AKS}"
  yq_merge_value_files "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_GKE_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_RBAC_GKE_MERGED_VALUE_FILE_NAME}"
  cp -a "/tmp/${HELM_CHART_RBAC_AKS_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC_AKS}" # Save the final value-file into the artifacts directory.
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_RBAC_AKS}"
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC_AKS}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_RBAC_GKE_MERGED_VALUE_FILE_NAME}" \
    --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \
    --set upstream.ingress.annotations."ingress\.gcp\.kubernetes\.io/pre-shared-cert"="${GKE_CERT_NAME}"
}