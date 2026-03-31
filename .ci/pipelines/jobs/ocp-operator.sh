#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

configure_schema_mode_runtime_env() {
  local namespace=$1
  local service_candidates=(
    "backstage-psql-${RELEASE_NAME}"
    "rhdh-postgresql"
    "redhat-developer-hub-postgresql"
  )
  local secret_candidates=(
    "postgres-cred"
    "rhdh-postgresql"
    "redhat-developer-hub-postgresql"
  )

  local postgres_service=""
  for candidate in "${service_candidates[@]}"; do
    if oc get svc "${candidate}" -n "${namespace}" &> /dev/null; then
      postgres_service="${candidate}"
      break
    fi
  done

  if [[ -z "${postgres_service}" ]]; then
    log::warn "Schema-mode nightly (operator): PostgreSQL service not found in ${namespace}; schema tests remain opt-in."
    return 1
  fi

  local admin_password=""
  for candidate in "${secret_candidates[@]}"; do
    if ! oc get secret "${candidate}" -n "${namespace}" &> /dev/null; then
      continue
    fi

    admin_password=$(oc get secret "${candidate}" -n "${namespace}" -o jsonpath='{.data.postgres-password}' 2> /dev/null | base64 -d || true)
    if [[ -z "${admin_password}" ]]; then
      admin_password=$(oc get secret "${candidate}" -n "${namespace}" -o jsonpath='{.data.POSTGRES_PASSWORD}' 2> /dev/null | base64 -d || true)
    fi
    if [[ -n "${admin_password}" ]]; then
      break
    fi
  done

  if [[ -z "${admin_password}" ]]; then
    log::warn "Schema-mode nightly (operator): unable to resolve PostgreSQL admin password in ${namespace}; schema tests remain opt-in."
    return 1
  fi

  pkill -f "port-forward.*${namespace}.*5432:5432" || true
  oc port-forward -n "${namespace}" "svc/${postgres_service}" 5432:5432 > /tmp/schema-mode-port-forward-operator.log 2>&1 &
  sleep 2
  if ! nc -z localhost 5432; then
    log::warn "Schema-mode nightly (operator): port-forward to ${postgres_service} failed; schema tests remain opt-in."
    return 1
  fi

  export SCHEMA_MODE_DB_HOST="localhost"
  export SCHEMA_MODE_DB_ADMIN_PASSWORD="${admin_password}"
  export SCHEMA_MODE_DB_PASSWORD="${SCHEMA_MODE_DB_PASSWORD:-test_password_123}"
  export SCHEMA_MODE_DB_USER="${SCHEMA_MODE_DB_USER:-backstage_schema_user}"

  log::info "Schema-mode nightly env configured for operator runtime namespace ${namespace}"
}

initiate_operator_deployments() {
  log::info "Initiating Operator-backed deployments on OCP"

  namespace::configure "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  config::create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"
  # TODO: https://issues.redhat.com/browse/RHDHBUGS-2184 fix orchestrator workflows deployment on operator
  # enable_orchestrator_plugins_op "${NAME_SPACE}"
  # deploy_orchestrator_workflows_operator "${NAME_SPACE}"
  log::warn "Skipping orchestrator plugins and workflows deployment on Operator $NAME_SPACE deployment"

  namespace::configure "${NAME_SPACE_RBAC}"
  config::create_conditional_policies_operator /tmp/conditional-policies.yaml
  config::prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  config::create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  wait_for_crunchy_crd || return 1
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"
  # TODO: https://issues.redhat.com/browse/RHDHBUGS-2184 fix orchestrator workflows deployment on operator
  # enable_orchestrator_plugins_op "${NAME_SPACE_RBAC}"
  # deploy_orchestrator_workflows_operator "${NAME_SPACE_RBAC}"
  log::warn "Skipping orchestrator plugins and workflows deployment on Operator $NAME_SPACE_RBAC deployment"
}

# OSD-GCP specific operator deployment that skips orchestrator workflows
initiate_operator_deployments_osd_gcp() {
  log::info "Initiating Operator-backed deployments on OSD-GCP (orchestrator disabled)"

  namespace::configure "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  # Merge base values with OSD-GCP diff file before creating dynamic plugins config
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase_OSD-GCP.yaml"
  config::create_dynamic_plugins_config "/tmp/merged-values_showcase_OSD-GCP.yaml" "/tmp/configmap-dynamic-plugins.yaml"
  common::save_artifact "${PW_PROJECT_SHOWCASE_OPERATOR}" "/tmp/configmap-dynamic-plugins.yaml"

  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"

  # Skip orchestrator plugins and workflows for OSD-GCP
  log::warn "Skipping orchestrator plugins and workflows deployment on OSD-GCP environment"

  namespace::configure "${NAME_SPACE_RBAC}"
  config::create_conditional_policies_operator /tmp/conditional-policies.yaml
  config::prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"

  # Merge RBAC values with OSD-GCP diff file before creating dynamic plugins config
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml"
  config::create_dynamic_plugins_config "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  common::save_artifact "${PW_PROJECT_SHOWCASE_OPERATOR_RBAC}" "/tmp/configmap-dynamic-plugins-rbac.yaml"

  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  wait_for_crunchy_crd || return 1
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"

  # Skip orchestrator plugins and workflows for OSD-GCP RBAC
  log::warn "Skipping orchestrator plugins and workflows deployment on OSD-GCP RBAC environment"
}

run_operator_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  namespace::configure "${NAME_SPACE_RUNTIME}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${NAME_SPACE_RUNTIME}"
  config::create_app_config_map "$DIR/resources/postgres-db/rds-app-config.yaml" "${NAME_SPACE_RUNTIME}"
  deploy_rhdh_operator "${NAME_SPACE_RUNTIME}" "${DIR}/resources/rhdh-operator/rhdh-start-runtime.yaml"
  configure_schema_mode_runtime_env "${NAME_SPACE_RUNTIME}" || true
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" "${runtime_url}" || true
}

handle_ocp_operator() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_RUNTIME="${NAME_SPACE_RUNTIME:-showcase-runtime}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE
  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local rbac_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_ocp_operator

  prepare_operator

  # Use OSD-GCP specific deployment for osd-gcp jobs (orchestrator disabled)
  if [[ "${JOB_NAME}" =~ osd-gcp ]]; then
    log::info "Detected OSD-GCP operator job, using OSD-GCP specific deployment (orchestrator disabled)"
    initiate_operator_deployments_osd_gcp
  else
    initiate_operator_deployments
  fi

  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_OPERATOR}" "${url}"
  testing::check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_OPERATOR_RBAC}" "${rbac_url}"

  # Runtime config-change tests are required to include schema-mode tests in operator nightly.
  # Keep this scoped to nightly jobs to limit risk while RHDHBUGS-2608 is tracked.
  if [[ "${JOB_NAME}" == *nightly* ]]; then
    run_operator_runtime_config_change_tests
  fi
}
