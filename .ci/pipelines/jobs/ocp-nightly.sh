#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

configure_schema_mode_runtime_env() {
  local namespace=$1
  local release_name=$2

  local service_candidates=(
    "${release_name}-postgresql"
    "redhat-developer-hub-postgresql"
  )
  local secret_candidates=(
    "${release_name}-postgresql"
    "redhat-developer-hub-postgresql"
    "postgres-cred"
  )

  local postgres_service=""
  for candidate in "${service_candidates[@]}"; do
    if oc get svc "${candidate}" -n "${namespace}" &>/dev/null; then
      postgres_service="${candidate}"
      break
    fi
  done

  if [[ -z "${postgres_service}" ]]; then
    log::warn "Schema-mode nightly: PostgreSQL service not found in ${namespace}; schema tests remain opt-in."
    return 1
  fi

  local admin_password=""
  for candidate in "${secret_candidates[@]}"; do
    if ! oc get secret "${candidate}" -n "${namespace}" &>/dev/null; then
      continue
    fi

    admin_password=$(oc get secret "${candidate}" -n "${namespace}" -o jsonpath='{.data.postgres-password}' 2>/dev/null | base64 -d || true)
    if [[ -z "${admin_password}" ]]; then
      admin_password=$(oc get secret "${candidate}" -n "${namespace}" -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d || true)
    fi
    if [[ -n "${admin_password}" ]]; then
      break
    fi
  done

  if [[ -z "${admin_password}" ]]; then
    log::warn "Schema-mode nightly: unable to resolve PostgreSQL admin password in ${namespace}; schema tests remain opt-in."
    return 1
  fi

  pkill -f "port-forward.*${namespace}.*5432:5432" || true
  oc port-forward -n "${namespace}" "svc/${postgres_service}" 5432:5432 >/tmp/schema-mode-port-forward.log 2>&1 &
  sleep 2
  if ! nc -z localhost 5432; then
    log::warn "Schema-mode nightly: port-forward to ${postgres_service} failed; schema tests remain opt-in."
    return 1
  fi

  export SCHEMA_MODE_DB_HOST="localhost"
  export SCHEMA_MODE_DB_ADMIN_PASSWORD="${admin_password}"
  export SCHEMA_MODE_DB_PASSWORD="${SCHEMA_MODE_DB_PASSWORD:-test_password_123}"
  export SCHEMA_MODE_DB_USER="${SCHEMA_MODE_DB_USER:-bn_backstage}"

  log::info "Schema-mode nightly env configured for namespace ${namespace}"
}

handle_ocp_nightly() {
  export NAME_SPACE="${NAME_SPACE:-showcase-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-nightly}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db-nightly}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  # Use OSD-GCP specific deployment for osd-gcp jobs (orchestrator disabled)
  if [[ "${JOB_NAME}" == *osd-gcp* ]]; then
    log::info "Detected OSD-GCP job, using OSD-GCP specific deployment (orchestrator disabled)"
    initiate_deployments_osd_gcp "${PW_PROJECT_SHOWCASE}" "${PW_PROJECT_SHOWCASE_RBAC}"
  else
    initiate_deployments "${PW_PROJECT_SHOWCASE}" "${PW_PROJECT_SHOWCASE_RBAC}"
  fi

  deploy_test_backstage_customization_provider "${NAME_SPACE}"

  run_standard_deployment_tests
  run_runtime_config_change_tests
  run_sanity_plugins_check

  # Skip localization tests for OSD-GCP jobs
  if [[ "${JOB_NAME}" != *osd-gcp* ]]; then
    run_localization_tests
  fi

}

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC}" "${rbac_url}"
}

run_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  initiate_runtime_deployment "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}"
  configure_schema_mode_runtime_env "${NAME_SPACE_RUNTIME}" "${RELEASE_NAME}" || true
  local runtime_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" "${runtime_url}" || true
}

run_sanity_plugins_check() {
  local sanity_plugins_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE_SANITY_PLUGINS_CHECK}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_sanity_plugin_checks_deployment "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${sanity_plugins_url}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE_SANITY_PLUGINS_CHECK}" "${PW_PROJECT_SHOWCASE_SANITY_PLUGINS}" "${sanity_plugins_url}"
}

run_localization_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local locales=("FR" "IT" "JA")

  log::section "Running localization tests"
  # Loop through all locales - uses project name as artifacts_subdir to avoid overwriting test artifacts
  for locale in "${locales[@]}"; do
    local project_var="PW_PROJECT_SHOWCASE_LOCALIZATION_${locale}"
    local project="${!project_var}"
    log::info "Running localization test for ${locale} (project: ${project})"
    testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${project}" "${url}" "" "" "${project}"
  done
}
