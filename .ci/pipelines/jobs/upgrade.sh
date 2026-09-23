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

handle_ocp_helm_upgrade() {
  export NAME_SPACE="${NAME_SPACE:-showcase-upgrade-nightly}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-${NAME_SPACE}-postgres-external-db}"
  export DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-${RELEASE_NAME}-developer-hub}"

  # Dynamically determine the previous release version and chart version
  local current_release_version
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
      log::error "Failed to determine correct chart version for $previous_release_version. Exiting."
      save_overall_result 1
      exit 1
    fi
  else
    log::info "Using preset CHART_VERSION_BASE: ${CHART_VERSION_BASE}"
  fi
  export CHART_VERSION_BASE
  log::info "Using previous release version: ${previous_release_version} and chart version: ${CHART_VERSION_BASE}"
  export TAG_NAME_BASE=$previous_release_version

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  trap 'test_run_tracker::mark_deploy_failed "${PW_PROJECT_SHOWCASE_UPGRADE:-showcase-upgrade}"' ERR
  initiate_upgrade_base_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"

  postgres::wait_ready "${NAME_SPACE}" "${RELEASE_NAME}"
  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "showcase-upgrade-base"; then
    log::error "Previous RHDH deployment did not become ready"
    oc describe "deployment/${DEPLOYMENT_NAME}" -n "${NAME_SPACE}" || true
    oc get events -n "${NAME_SPACE}" --sort-by='.lastTimestamp' || true
    return 1
  fi

  local previous_postgres_major target_postgres_major
  previous_postgres_major=$(postgres::server_major "${NAME_SPACE}" "${RELEASE_NAME}")
  target_postgres_major=$(postgres::major_from_image_repository "${POSTGRESQL_IMAGE_REPO}")
  log::info "PostgreSQL upgrade check: previous=${previous_postgres_major}, target=${target_postgres_major}"

  POSTGRES_UPGRADE_DUMP_FILE=""

  if [[ "${previous_postgres_major}" != "${target_postgres_major}" ]]; then
    log::info "PostgreSQL major versions differ; performing dump/restore migration"
    postgres::seed_migration_proof "${NAME_SPACE}" "${RELEASE_NAME}"
    postgres::quiesce_application "${NAME_SPACE}" "${DEPLOYMENT_NAME}"

    POSTGRES_UPGRADE_DUMP_FILE=$(mktemp "${TMPDIR:-${DIR}}/rhdh-postgres-upgrade.XXXXXX")
    postgres::dump_all "${NAME_SPACE}" "${RELEASE_NAME}" "${POSTGRES_UPGRADE_DUMP_FILE}"
    postgres::remove_data_volume "${NAME_SPACE}" "${RELEASE_NAME}"

    # Install the target PostgreSQL with the hub stopped so it cannot initialize
    # empty application databases before the logical restore completes.
    initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" 0
    postgres::wait_ready "${NAME_SPACE}" "${RELEASE_NAME}" "${target_postgres_major}"
    postgres::restore_all "${NAME_SPACE}" "${RELEASE_NAME}" "${POSTGRES_UPGRADE_DUMP_FILE}"
    postgres::refresh_collation_versions "${NAME_SPACE}" "${RELEASE_NAME}"
    postgres::verify_migration_proof "${NAME_SPACE}" "${RELEASE_NAME}"

    # Persist the normal replica count in Helm and reconnect RHDH to PostgreSQL.
    initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  else
    log::info "PostgreSQL major versions match; skipping database migration"
    initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  fi

  trap - ERR
  testing::check_upgrade_and_test "${DEPLOYMENT_NAME}" "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_UPGRADE}" "${url}"
  if [[ -n "${POSTGRES_UPGRADE_DUMP_FILE:-}" ]]; then
    rm -f "${POSTGRES_UPGRADE_DUMP_FILE}" "${POSTGRES_UPGRADE_DUMP_FILE}.restore.log"
  fi
  unset POSTGRES_UPGRADE_DUMP_FILE
}
