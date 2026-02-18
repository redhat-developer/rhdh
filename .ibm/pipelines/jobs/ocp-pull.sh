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

  # Ensure the Crunchy Postgres operator pod is fully ready before creating
  # the PostgresCluster. The CSV may be "Succeeded" and the CRD registered,
  # but the operator pod might still be starting. If we create the CR too
  # early, the operator only partially reconciles it (secrets are created
  # but PVCs like postgress-external-db-repo1 are not), leaving the
  # instance pod stuck in Pending forever.
  log::info "Waiting for Crunchy Postgres operator pod to be ready..."
  oc wait --for=condition=Ready pod \
    -l postgres-operator.crunchydata.com/control-plane=postgres-operator \
    -n openshift-operators --timeout=300s 2> /dev/null \
    || oc wait --for=condition=Ready pod \
      -l app.kubernetes.io/name=pgo \
      -n openshift-operators --timeout=300s 2> /dev/null \
    || log::warn "Could not verify operator pod readiness, proceeding anyway..."
  log::info "Crunchy Postgres operator is ready."

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

  # Without orchestrator the helm install returns quickly, but the external
  # PostgreSQL may still be starting. Backstage does not retry DB connections
  # after a failed startup, so the initial pod will crash-loop.
  # Wait for PostgreSQL to be ready, then restart the RHDH deployment so the
  # new pod connects to the now-ready database.
  wait_for_postgres_and_restart_rhdh
  log::warn "Skipping sonataflow database workaround for PR job"
  log::warn "Skipping orchestrator workflows deployment for PR job"
}

# Wait for the external PostgreSQL pod to become ready, logging its status
# periodically for diagnostics. Once ready, restart the RHDH RBAC deployment
# so the new pod can connect to the database.
wait_for_postgres_and_restart_rhdh() {
  local pg_label="postgres-operator.crunchydata.com/cluster=postgress-external-db"
  local max_wait=900
  local interval=30
  local elapsed=0

  log::info "Waiting for PostgreSQL pod to be ready in ${NAME_SPACE_POSTGRES_DB} (up to ${max_wait}s)..."

  while [ "$elapsed" -lt "$max_wait" ]; do
    # Check if any postgres data pod is Ready
    if oc wait --for=condition=Ready pod \
      -l "${pg_label},postgres-operator.crunchydata.com/data=postgres" \
      -n "${NAME_SPACE_POSTGRES_DB}" --timeout=5s 2> /dev/null; then
      log::info "PostgreSQL pod is ready after ${elapsed}s."

      # Restart RHDH RBAC deployment so the new pod connects to the ready DB
      local rbac_deploy="${RELEASE_NAME_RBAC}-developer-hub"
      log::info "Restarting RHDH RBAC deployment to connect to PostgreSQL..."
      oc rollout restart "deployment/${rbac_deploy}" -n "${NAME_SPACE_RBAC}"
      oc rollout status "deployment/${rbac_deploy}" -n "${NAME_SPACE_RBAC}" --timeout=300s
      return 0
    fi

    # Log pod and PVC status for diagnostics
    log::info "PostgreSQL status at ${elapsed}s:"
    oc get pods -l "${pg_label}" -n "${NAME_SPACE_POSTGRES_DB}" -o wide --no-headers 2>&1 | while IFS= read -r line; do
      log::info "  pod: ${line}"
    done
    oc get pvc -n "${NAME_SPACE_POSTGRES_DB}" --no-headers 2>&1 | while IFS= read -r line; do
      log::info "  pvc: ${line}"
    done

    sleep "${interval}"
    elapsed=$((elapsed + interval + 5))
  done

  log::error "PostgreSQL pod did not become ready within ${max_wait}s"
  log::info "Final pod describe:"
  oc describe pods -l "${pg_label},postgres-operator.crunchydata.com/data=postgres" \
    -n "${NAME_SPACE_POSTGRES_DB}" 2>&1 | tail -40
  log::info "Events in namespace:"
  oc get events -n "${NAME_SPACE_POSTGRES_DB}" --sort-by='.lastTimestamp' 2>&1 | tail -20
  return 1
}
