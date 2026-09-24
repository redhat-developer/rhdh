#!/bin/bash

if [[ -n "${UPGRADE_JOBS_SOURCED:-}" ]]; then
  return 0
fi
readonly UPGRADE_JOBS_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/lib/postgres.sh
source "$DIR"/lib/postgres.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

upgrade::save_phase_artifacts() {
  local phase=${1:-unknown}
  local namespace=${NAME_SPACE:-}
  local release_name=${RELEASE_NAME:-}
  local artifacts_subdir="${PW_PROJECT_SHOWCASE_UPGRADE:-showcase-upgrade}/${phase}"

  if [[ -z "${namespace}" || -z "${release_name}" ]]; then
    log::warn "Upgrade artifact context is incomplete; skipping ${phase} diagnostics"
    return 0
  fi

  if [[ "${phase}" == failure-* && -n "${POSTGRES_UPGRADE_DUMP_FILE:-}" && -f "${POSTGRES_UPGRADE_DUMP_FILE}.restore.log" ]]; then
    common::save_artifact "${artifacts_subdir}" "${POSTGRES_UPGRADE_DUMP_FILE}.restore.log" || true
  fi

  local diagnostics_file
  diagnostics_file=$(mktemp "${TMPDIR:-${DIR}}/upgrade-${phase}.XXXXXX.txt") || return 0
  {
    printf 'phase: %s\n' "${phase}"
    printf 'namespace: %s\n' "${namespace}"
    printf 'release: %s\n' "${release_name}"
    printf 'previous PostgreSQL major: %s\n' "${UPGRADE_PREVIOUS_POSTGRES_MAJOR:-unknown}"
    printf 'target PostgreSQL major: %s\n\n' "${UPGRADE_TARGET_POSTGRES_MAJOR:-unknown}"
    echo '=== Helm status ==='
    helm status "${release_name}" -n "${namespace}" || true
    echo '=== Helm history ==='
    helm history "${release_name}" -n "${namespace}" || true
    echo '=== Workloads and storage ==='
    oc get pods,deployments,statefulsets,pvc -n "${namespace}" -o wide || true
    echo '=== Deployment ==='
    oc describe "deployment/${DEPLOYMENT_NAME}" -n "${namespace}" || true
    echo '=== PostgreSQL StatefulSet ==='
    oc describe "statefulset/${release_name}-postgresql" -n "${namespace}" || true
    echo '=== Recent events ==='
    oc get events -n "${namespace}" --sort-by='.lastTimestamp' || true
  } > "${diagnostics_file}" 2>&1

  common::save_artifact "${artifacts_subdir}" "${diagnostics_file}" || true
  rm -f "${diagnostics_file}"
  save_all_pod_logs "${namespace}" "${artifacts_subdir}" || true
}

upgrade::handle_failure() {
  local exit_status=${1:-1}
  local phase=${UPGRADE_PHASE:-unknown}
  case "${UPGRADE_FAILURE_KIND:-}" in
    deployment)
      log::error "Upgrade deployment failed during ${phase} with status ${exit_status}"
      test_run_tracker::mark_deploy_failed "${PW_PROJECT_SHOWCASE_UPGRADE:-showcase-upgrade}" || true
      upgrade::save_phase_artifacts "failure-${phase}"
      ;;
    test)
      log::error "Upgrade test setup failed with status ${exit_status}"
      upgrade::save_phase_artifacts "failure-tests"
      ;;
  esac
}

upgrade::exit_handler() {
  local exit_status=$?
  if [[ ${exit_status} -ne 0 ]]; then
    upgrade::handle_failure "${exit_status}" || true
    save_overall_result 1
  fi
  cleanup || true
  return "${exit_status}"
}

handle_ocp_helm_upgrade() {
  export NAME_SPACE="${NAME_SPACE:-showcase-upgrade-nightly}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-${NAME_SPACE}-postgres-external-db}"
  export DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-${RELEASE_NAME}-developer-hub}"

  local upgrade_artifacts_subdir="${PW_PROJECT_SHOWCASE_UPGRADE:-showcase-upgrade}"
  UPGRADE_FAILURE_KIND="deployment"
  UPGRADE_PHASE="configuration"
  trap upgrade::exit_handler EXIT

  # Resolve the previous release's chart and values for the baseline deployment.
  local current_release_version previous_release_version
  current_release_version=$(helm::get_chart_stream)
  if [[ -z "$current_release_version" ]]; then
    log::error "Failed to determine current release version. Exiting."
    save_overall_result 1
    exit 1
  fi
  previous_release_version=$(common::get_previous_release_version "$current_release_version")
  if [[ -z "$previous_release_version" ]]; then
    log::error "Failed to determine latest release version. Exiting."
    save_overall_result 1
    exit 1
  fi
  export IMAGE_REPO_BASE="${IMAGE_REPO_BASE:-${QUAY_REPO_BASE:-$(common::default_hub_image_repo "release-${previous_release_version}")}}"
  export QUAY_REPO_BASE="${IMAGE_REPO_BASE}" # Keep QUAY_REPO_BASE in sync for backward compatibility
  if [[ -z "${CHART_VERSION_BASE:-}" ]]; then
    CHART_VERSION_BASE=$(helm::get_chart_version "$previous_release_version")
    if [[ -z "$CHART_VERSION_BASE" ]]; then
      log::error "Failed to determine chart version for $previous_release_version. Exiting."
      save_overall_result 1
      exit 1
    fi
  else
    log::info "Using preset CHART_VERSION_BASE: ${CHART_VERSION_BASE}"
  fi
  if [[ "${CHART_VERSION_BASE%%.*}" != "${previous_release_version%%.*}" ]]; then
    log::error "Base chart ${CHART_VERSION_BASE} does not match previous release ${previous_release_version}"
    save_overall_result 1
    exit 1
  fi
  export CHART_VERSION_BASE
  log::info "Using previous release version: ${previous_release_version} and chart version: ${CHART_VERSION_BASE}"
  export TAG_NAME_BASE=$previous_release_version

  UPGRADE_PHASE="cluster-setup"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  UPGRADE_PHASE="baseline-deploy"
  initiate_upgrade_base_deployments \
    "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${upgrade_artifacts_subdir}" "${previous_release_version}"

  UPGRADE_PHASE="baseline-readiness"
  postgres::wait_ready "${NAME_SPACE}" "${RELEASE_NAME}"
  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${upgrade_artifacts_subdir}/baseline"; then
    log::error "Previous RHDH deployment did not become ready"
    oc describe "deployment/${DEPLOYMENT_NAME}" -n "${NAME_SPACE}" || true
    oc get events -n "${NAME_SPACE}" --sort-by='.lastTimestamp' || true
    return 1
  fi
  upgrade::save_phase_artifacts "baseline"

  local previous_postgres_major target_postgres_major
  UPGRADE_PHASE="postgres-version-check"
  previous_postgres_major=$(postgres::server_major "${NAME_SPACE}" "${RELEASE_NAME}")
  target_postgres_major=$(postgres::major_from_image_repository "${POSTGRESQL_IMAGE_REPO}")
  UPGRADE_PREVIOUS_POSTGRES_MAJOR="${previous_postgres_major}"
  UPGRADE_TARGET_POSTGRES_MAJOR="${target_postgres_major}"
  log::info "PostgreSQL upgrade check: previous=${previous_postgres_major}, target=${target_postgres_major}"

  POSTGRES_UPGRADE_DUMP_FILE=""
  common::save_artifact "${upgrade_artifacts_subdir}/target" \
    "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" || true

  if [[ "${previous_postgres_major}" != "${target_postgres_major}" ]]; then
    log::info "PostgreSQL major versions differ; performing dump/restore migration"
    UPGRADE_PHASE="migration-proof"
    postgres::seed_migration_proof "${NAME_SPACE}" "${RELEASE_NAME}"
    UPGRADE_PHASE="application-quiesce"
    postgres::quiesce_application "${NAME_SPACE}" "${DEPLOYMENT_NAME}"

    UPGRADE_PHASE="postgres-dump"
    POSTGRES_UPGRADE_DUMP_FILE=$(mktemp "${TMPDIR:-${DIR}}/rhdh-postgres-upgrade.XXXXXX")
    postgres::dump_all "${NAME_SPACE}" "${RELEASE_NAME}" "${POSTGRES_UPGRADE_DUMP_FILE}"
    UPGRADE_PHASE="postgres-volume-replacement"
    postgres::remove_data_volume "${NAME_SPACE}" "${RELEASE_NAME}"

    # Install the target PostgreSQL with the hub stopped so it cannot initialize
    # empty application databases before the logical restore completes.
    UPGRADE_PHASE="target-postgres-deploy"
    initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" 0
    postgres::wait_ready "${NAME_SPACE}" "${RELEASE_NAME}" "${target_postgres_major}"
    upgrade::save_phase_artifacts "target-postgres"
    UPGRADE_PHASE="postgres-restore"
    postgres::restore_all "${NAME_SPACE}" "${RELEASE_NAME}" "${POSTGRES_UPGRADE_DUMP_FILE}"
    postgres::refresh_collation_versions "${NAME_SPACE}" "${RELEASE_NAME}"
    postgres::verify_migration_proof "${NAME_SPACE}" "${RELEASE_NAME}"

    # Persist the normal replica count in Helm and reconnect RHDH to PostgreSQL.
    UPGRADE_PHASE="target-deploy"
    initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  else
    log::info "PostgreSQL major versions match; skipping database migration"
    UPGRADE_PHASE="target-deploy"
    initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  fi

  UPGRADE_PHASE="target-rollout"
  testing::check_helm_upgrade "${DEPLOYMENT_NAME}" "${NAME_SPACE}"
  UPGRADE_PHASE="target-readiness"
  if ! testing::check_backstage_running \
    "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${upgrade_artifacts_subdir}"; then
    log::error "Upgraded RHDH deployment did not become ready"
    return 1
  fi
  upgrade::save_phase_artifacts "target"
  UPGRADE_PHASE="tests"
  UPGRADE_FAILURE_KIND="test"
  if [[ "${SKIP_TESTS:-false}" == "true" ]]; then
    log::info "SKIP_TESTS=true, skipping test execution for namespace: ${NAME_SPACE}"
    test_run_tracker::register "${upgrade_artifacts_subdir}"
    test_run_tracker::mark_deploy_success
    test_run_tracker::mark_test_result "true" 0
  elif testing::run_tests \
    "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_UPGRADE}" "${url}" \
    "${upgrade_artifacts_subdir}"; then
    log::info "Upgrade tests passed — skipping additional pod log collection"
  else
    save_overall_result 1
    upgrade::save_phase_artifacts "failure-tests"
  fi
  UPGRADE_FAILURE_KIND=
  trap cleanup EXIT
  if [[ -n "${POSTGRES_UPGRADE_DUMP_FILE:-}" ]]; then
    rm -f "${POSTGRES_UPGRADE_DUMP_FILE}" "${POSTGRES_UPGRADE_DUMP_FILE}.restore.log"
  fi
  unset POSTGRES_UPGRADE_DUMP_FILE
}
