#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

initiate_operator_deployments() {
  log::info "Initiating Operator-backed deployments on OCP"

  namespace::configure "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"
  enable_orchestrator_plugins_op "${NAME_SPACE}"
  deploy_orchestrator_workflows_operator "${NAME_SPACE}"

  namespace::configure "${NAME_SPACE_RBAC}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"
  enable_orchestrator_plugins_op "${NAME_SPACE_RBAC}"
  deploy_orchestrator_workflows_operator "${NAME_SPACE_RBAC}"
}

# OSD-GCP specific operator deployment that skips orchestrator workflows
initiate_operator_deployments_osd_gcp() {
  log::info "Initiating Operator-backed deployments on OSD-GCP (orchestrator disabled)"

  prepare_operator

  namespace::configure "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  # Merge base values with OSD-GCP diff file before creating dynamic plugins config
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase_OSD-GCP.yaml"
  create_dynamic_plugins_config "/tmp/merged-values_showcase_OSD-GCP.yaml" "/tmp/configmap-dynamic-plugins.yaml"
  common::save_artifact "${NAME_SPACE}" "/tmp/configmap-dynamic-plugins.yaml"

  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"

  # Skip orchestrator plugins and workflows for OSD-GCP
  log::warn "Skipping orchestrator plugins and workflows deployment on OSD-GCP environment"

  namespace::configure "${NAME_SPACE_RBAC}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"

  # Merge RBAC values with OSD-GCP diff file before creating dynamic plugins config
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml"
  create_dynamic_plugins_config "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  common::save_artifact "${NAME_SPACE_RBAC}" "/tmp/configmap-dynamic-plugins-rbac.yaml"

  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"

  # Skip orchestrator plugins and workflows for OSD-GCP RBAC
  log::warn "Skipping orchestrator plugins and workflows deployment on OSD-GCP RBAC environment"
}

run_operator_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  namespace::configure "${NAME_SPACE_RUNTIME}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${NAME_SPACE_RUNTIME}"
  create_app_config_map "$DIR/resources/postgres-db/rds-app-config.yaml" "${NAME_SPACE_RUNTIME}"
  deploy_rhdh_operator "${NAME_SPACE_RUNTIME}" "${DIR}/resources/rhdh-operator/rhdh-start-runtime.yaml"
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" "${runtime_url}"
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

  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_OPERATOR}" "${url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_OPERATOR_RBAC}" "${rbac_url}"

  run_operator_runtime_config_change_tests
}
