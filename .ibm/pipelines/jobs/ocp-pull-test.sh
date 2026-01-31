#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_ocp_pull_test() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

  log::info "Configuring namespace: ${NAME_SPACE_RBAC}"
  common::oc_login
  log::info "OCP version: $(oc version)"

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  # Only deploy RBAC instance (skip base deployment)
  log::info "Deploying only showcase-rbac instance for testing"
  namespace::configure "${NAME_SPACE_POSTGRES_DB}"
  namespace::configure "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  cd "${DIR}" || return 1
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE_RBAC}"

  if is_pr_e2e_ocp_helm_job; then
    local merged_pr_rbac_value_file="/tmp/merged-values_showcase-rbac_PR.yaml"
    helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase-rbac_PR.yaml" "${merged_pr_rbac_value_file}"
    disable_orchestrator_plugins_in_values "${merged_pr_rbac_value_file}"

    mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
    cp -a "${merged_pr_rbac_value_file}" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" || true
    # shellcheck disable=SC2046
    helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
      "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
      -f "${merged_pr_rbac_value_file}" \
      --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
      $(helm::get_image_params)
  else
    helm::install "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${HELM_CHART_RBAC_VALUE_FILE_NAME}"
  fi

  # Skip orchestrator workflows for PR
  if is_pr_e2e_ocp_helm_job; then
    log::warn "Skipping sonataflow (orchestrator) external DB SSL workaround on PR job: ${JOB_NAME}"
    log::warn "Skipping orchestrator workflows deployment on PR job: ${JOB_NAME}"
  else
    # NOTE: This is a workaround to allow the sonataflow platform to connect to the external postgres db using ssl.
    if ! k8s_wait::job "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}-create-sonataflow-database" 10 10; then
      echo "❌ Failed to create sonataflow database. Aborting RBAC deployment."
      return 1
    fi
    oc -n "${NAME_SPACE_RBAC}" patch sfp sonataflow-platform --type=merge \
      -p '{"spec":{"services":{"jobService":{"podTemplate":{"container":{"env":[{"name":"QUARKUS_DATASOURCE_REACTIVE_URL","value":"postgresql://postgress-external-db-primary.postgress-external-db.svc.cluster.local:5432/sonataflow?search_path=jobs-service&sslmode=require&ssl=true&trustAll=true"},{"name":"QUARKUS_DATASOURCE_REACTIVE_SSL_MODE","value":"require"},{"name":"QUARKUS_DATASOURCE_REACTIVE_TRUST_ALL","value":"true"}]}}}}}}'
    oc rollout restart deployment/sonataflow-platform-jobs-service -n "${NAME_SPACE_RBAC}"
    deploy_orchestrator_workflows "${NAME_SPACE_RBAC}"
  fi

  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  log::info "RBAC URL: ${rbac_url}"
  testing::check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC}" "${rbac_url}"
}
