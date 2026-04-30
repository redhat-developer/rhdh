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
# shellcheck source=.ci/pipelines/lib/schema-mode-env.sh
source "$DIR"/lib/schema-mode-env.sh

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

  # Deploy external PostgreSQL (Crunchy) and create real secrets in the runtime namespace
  namespace::configure "${NAME_SPACE_POSTGRES_DB}"
  configure_external_postgres_db "${NAME_SPACE_RUNTIME}"

  config::create_app_config_map "$DIR/resources/postgres-db/rds-app-config.yaml" "${NAME_SPACE_RUNTIME}"

  # Add RHDH_RUNTIME_URL to postgres-cred (configure_external_postgres_db doesn't include it,
  # but rds-app-config.yaml references it for app/backend baseUrl)
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  oc patch secret postgres-cred -n "${NAME_SPACE_RUNTIME}" --type merge \
    -p "{\"stringData\":{\"RHDH_RUNTIME_URL\":\"${runtime_url}\"}}"

  deploy_rhdh_operator "${NAME_SPACE_RUNTIME}" "${DIR}/resources/rhdh-operator/rhdh-start-runtime.yaml" "true"

  export INSTALL_METHOD=operator

  # Configure schema-mode environment (opt-in: tests skip if env not configured)
  if configure_schema_mode_runtime_env "${NAME_SPACE_RUNTIME}" "${RELEASE_NAME}" operator; then
    log::info "Schema-mode environment configured successfully; schema-mode tests will run"
  else
    log::warn "Schema-mode environment not configured; schema-mode tests will skip (this is expected if PostgreSQL is not available)"
  fi

  testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" "${runtime_url}" || true
}

handle_ocp_operator() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_RUNTIME="${NAME_SPACE_RUNTIME:-showcase-runtime}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

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

  run_operator_runtime_config_change_tests
}
