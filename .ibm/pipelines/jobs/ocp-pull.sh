#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_ocp_pull() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

  log::info "Configuring namespace: ${NAME_SPACE}"
  oc_login
  log::info "OCP version: $(oc version)"

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE
  cluster_setup_ocp_helm

  cd "${DIR}" || return 1
  # PR jobs: deploy with orchestrator disabled to avoid SonataFlow deployment timeouts.
  # Orchestrator is fully tested in nightly jobs.
  base_deployment_pr
  rbac_deployment_pr

  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC}" "${rbac_url}"
}

# Base deployment with orchestrator disabled (for PR jobs)
base_deployment_pr() {
  configure_namespace ${NAME_SPACE}

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}" || return 1
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  # Merge base values with PR diff file to disable orchestrator
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_PR_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase_PR.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE}"
  cp -a "/tmp/merged-values_showcase_PR.yaml" "${ARTIFACT_DIR}/${NAME_SPACE}/" || true

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged-values_showcase_PR.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)

  log::warn "Skipping orchestrator workflows deployment for PR job"
}

# RBAC deployment with orchestrator disabled (for PR jobs)
rbac_deployment_pr() {
  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"

  # Merge RBAC values with PR diff file to disable orchestrator
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_PR_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase-rbac_PR.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
  cp -a "/tmp/merged-values_showcase-rbac_PR.yaml" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" || true

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"

  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged-values_showcase-rbac_PR.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)

  # Without orchestrator, the deploy finishes faster and the external PostgreSQL
  # may not yet be accepting connections when the RHDH pod starts. Backstage does
  # not retry DB connections after a failed startup, so the pod stays broken.
  # Wait for the deployment to become ready; if it doesn't, restart it so the new
  # pod can connect to the now-ready PostgreSQL.
  local rbac_deploy="${RELEASE_NAME_RBAC}-developer-hub"
  if ! oc rollout status "deployment/${rbac_deploy}" -n "${NAME_SPACE_RBAC}" --timeout=300s 2>/dev/null; then
    log::warn "RHDH RBAC deployment not ready. Restarting to retry database connection..."
    oc rollout restart "deployment/${rbac_deploy}" -n "${NAME_SPACE_RBAC}"
    oc rollout status "deployment/${rbac_deploy}" -n "${NAME_SPACE_RBAC}" --timeout=300s
  fi

  log::warn "Skipping sonataflow database workaround for PR job"
  log::warn "Skipping orchestrator workflows deployment for PR job"
}
