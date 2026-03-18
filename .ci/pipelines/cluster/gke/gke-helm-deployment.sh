#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/lib/namespace.sh
source "$DIR"/lib/namespace.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ci/pipelines/cluster/gke/manifest.sh
source "$DIR"/cluster/gke/manifest.sh

initiate_gke_helm_deployment() {
  common::require_vars "RELEASE_NAME" "TAG_NAME" "QUAY_REPO" "K8S_CLUSTER_ROUTER_BASE" "GKE_CERT_NAME" || return 1

  namespace::delete "${NAME_SPACE_RBAC}"
  namespace::configure "${NAME_SPACE}"

  deploy_redis_cache "${NAME_SPACE}"

  helm::uninstall "${NAME_SPACE}" "${RELEASE_NAME}"

  cd "${DIR}" || exit
  local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  apply_gke_frontend_config "${NAME_SPACE}"
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_GKE_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"
  common::save_artifact "${PW_PROJECT_SHOWCASE_K8S}" "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}"

  namespace::setup_image_pull_secret "${NAME_SPACE}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  if ! helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_K8S_MERGED_VALUE_FILE_NAME}" \
    --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \
    --set upstream.ingress.annotations."ingress\.gcp\.kubernetes\.io/pre-shared-cert"="${GKE_CERT_NAME}"; then
    log::error "Helm upgrade failed for ${RELEASE_NAME} in ${NAME_SPACE}"
    return 1
  fi
}

initiate_rbac_gke_helm_deployment() {
  common::require_vars "RELEASE_NAME_RBAC" "TAG_NAME" "QUAY_REPO" "K8S_CLUSTER_ROUTER_BASE" "GKE_CERT_NAME" || return 1

  namespace::delete "${NAME_SPACE}"
  namespace::configure "${NAME_SPACE_RBAC}"

  helm::uninstall "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}"

  cd "${DIR}" || exit
  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  apply_gke_frontend_config "${NAME_SPACE_RBAC}"
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_GKE_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}"
  common::save_artifact "${PW_PROJECT_SHOWCASE_RBAC_K8S}" "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}"

  namespace::setup_image_pull_secret "${NAME_SPACE_RBAC}" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_RBAC}"
  if ! helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME}" \
    --set global.host="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \
    --set upstream.ingress.annotations."ingress\.gcp\.kubernetes\.io/pre-shared-cert"="${GKE_CERT_NAME}"; then
    log::error "Helm upgrade failed for ${RELEASE_NAME_RBAC} in ${NAME_SPACE_RBAC}"
    return 1
  fi
}
