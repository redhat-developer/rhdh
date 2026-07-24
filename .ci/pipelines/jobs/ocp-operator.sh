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
# shellcheck source=.ci/pipelines/lib/postgres.sh
source "$DIR"/lib/postgres.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/schema-mode-env.sh
source "$DIR"/lib/schema-mode-env.sh

export INSTALL_METHOD=operator

# Default operator-local DB image (RELATED_IMAGE_postgresql). Fedora path: 15 → 18 dump/restore.
OPERATOR_PG15_IMAGE="${OPERATOR_PG15_IMAGE:-quay.io/fedora/postgresql-15:latest}"
OPERATOR_PG18_IMAGE="${OPERATOR_PG18_IMAGE:-quay.io/fedora/postgresql-18:latest}"

initiate_operator_showcase_only() {
  log::info "Initiating Operator-backed showcase deployment (local Fedora PostgreSQL)"

  namespace::configure "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  config::create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"
}

# Wait for Postgres + Backstage, run Playwright, always persist artifacts under a unique subdir.
# Args:
#   $1 - label
#   $2 - artifacts_subdir
#   $3 - url
#   $4 - expected postgres image substring (e.g. postgresql-18)
#   $5 - optional max wait seconds (default: 600)
#   $6 - optional previous RHDH pod UID
#   $7 - optional "seed" to register persistence-proof catalog entity
_pg_upgrade_verify_and_test() {
  local label=$1
  local artifacts_subdir=$2
  local url=$3
  local expected_image_substr=$4
  local max_wait=${5:-600}
  local previous_rhdh_uid=${6:-}
  local seed_data=${7:-}
  local deploy
  deploy=$(rhdh_deployment_name "${RELEASE_NAME}")

  log::info "=== ${label}: wait for PostgreSQL (${expected_image_substr}) + Backstage, then Playwright ==="
  log::info "Artifacts subdir: ${ARTIFACT_DIR:-<unset>}/${artifacts_subdir}"

  if ! wait_for_postgres_ready "${NAME_SPACE}" "${max_wait}" "${expected_image_substr}" > /dev/null; then
    log::error "PostgreSQL not Ready after ${label}"
    dump_postgres_diagnostics "${NAME_SPACE}"
    _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"
    return 1
  fi
  log_postgres_version "${NAME_SPACE}"

  if [[ -n "${previous_rhdh_uid}" ]]; then
    if ! ensure_rhdh_pod_replaced "${RELEASE_NAME}" "${NAME_SPACE}" "${previous_rhdh_uid}" "${max_wait}"; then
      log::error "Previous RHDH pod did not terminate cleanly after ${label}"
      dump_postgres_diagnostics "${NAME_SPACE}"
      _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"
      return 1
    fi
  fi

  oc rollout status "deployment/${deploy}" -n "${NAME_SPACE}" --timeout=10m \
    || log::warn "Backstage rollout status check timed out after ${label}"

  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts_subdir}" 40 30; then
    log::error "Backstage not healthy after ${label}"
    dump_postgres_diagnostics "${NAME_SPACE}"
    _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"
    return 1
  fi

  if [[ "${seed_data}" == "seed" ]]; then
    if ! seed_pg_upgrade_data_proof "${url}" "${NAME_SPACE}"; then
      _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"
      return 1
    fi
  elif [[ "${PG_UPGRADE_DATA_PROOF:-}" == "1" ]]; then
    if ! assert_pg_upgrade_data_proof_api "${url}"; then
      log::error "Persistence proof entity missing via API after ${label}"
      _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"
      return 1
    fi
  fi

  export PG_UPGRADE_DATA_PROOF=1

  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_OPERATOR}" "${url}" "" "" "${artifacts_subdir}"

  _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"

  if [[ "${OVERALL_RESULT:-0}" -ne 0 ]]; then
    log::error "Playwright (or prior step) failed during ${label}; aborting remaining upgrade phases"
    return 1
  fi
}

_pg_save_phase_artifacts() {
  local artifacts_subdir=$1
  local label=$2
  local diag_file="/tmp/pg-diagnostics-${artifacts_subdir}.txt"

  log::info "Saving phase artifacts for '${label}' → ${ARTIFACT_DIR:-<unset>}/${artifacts_subdir}"
  dump_postgres_diagnostics "${NAME_SPACE}" > "${diag_file}" 2>&1 || true
  common::save_artifact "${artifacts_subdir}" "${diag_file}" "postgres" || true
  save_all_pod_logs "${NAME_SPACE}" "${artifacts_subdir}"
}

# RHIDP-14594: Operator-local Fedora PostgreSQL upgrade via dump/restore.
# Operator defaults RELATED_IMAGE_postgresql to quay.io/fedora/postgresql-15.
# Same Fedora constraints as Helm path (#5141): no reliable POSTGRESQL_UPGRADE=copy,
# no fedora/postgresql-17 — jump 15 → 18 with pg_dumpall / wipe PVC / restore.
# Showcase-only (RBAC + runtime skipped) to keep the job focused on DB upgrade evidence.
handle_ocp_operator() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_RUNTIME="${NAME_SPACE_RUNTIME:-showcase-runtime}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"
  export POSTGRES_CR_NAME="${POSTGRES_CR_NAME:-${RELEASE_NAME:-rhdh}}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE
  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local art_pg15="${PW_PROJECT_SHOWCASE_OPERATOR}-pg15"
  local art_pg18="${PW_PROJECT_SHOWCASE_OPERATOR}-pg18"
  local deploy
  deploy=$(rhdh_deployment_name "${RELEASE_NAME}")

  cluster_setup_ocp_operator

  if [[ "${JOB_NAME}" =~ osd-gcp ]]; then
    export MAX_PARALLEL=3
    prepare_operator 3
  else
    prepare_operator
  fi

  # Ensure baseline image is Fedora PG15 (operator CSV default; set explicitly for evidence).
  if ! set_operator_postgresql_related_image "${OPERATOR_PG15_IMAGE}"; then
    log::error "Failed to set operator RELATED_IMAGE_postgresql to PG15"
    return 1
  fi

  initiate_operator_showcase_only

  log::info "Phase PG15: operator-local ${OPERATOR_PG15_IMAGE}"
  if ! _pg_upgrade_verify_and_test "PG15 baseline" "${art_pg15}" "${url}" "postgresql-15" 600 "" "seed"; then
    return 1
  fi

  local rhdh_uid_before_18
  rhdh_uid_before_18=$(get_rhdh_pod_uid "${RELEASE_NAME}" "${NAME_SPACE}")
  log::info "RHDH pod uid before PG18 dump/restore: ${rhdh_uid_before_18:-<none>}"

  log::info "Phase PG18: dump/restore 15 → 18 (operator-local Fedora; skip PG16)"
  local dumpfile="/tmp/rhdh-operator-pg15-dumpall.sql"
  if ! postgres_dumpall_to_file "${NAME_SPACE}" "${dumpfile}"; then
    _pg_save_phase_artifacts "${art_pg18}" "PG18 dump failed"
    return 1
  fi
  common::save_artifact "${art_pg18}" "${dumpfile}" "postgres" || true

  # Switch operator default DB image to PG18 before wiping so recreate uses 18.
  if ! set_operator_postgresql_related_image "${OPERATOR_PG18_IMAGE}"; then
    dump_postgres_diagnostics "${NAME_SPACE}"
    _pg_save_phase_artifacts "${art_pg18}" "PG18 RELATED_IMAGE update failed"
    return 1
  fi

  postgres_wipe_persistent_volume "${NAME_SPACE}"

  if ! postgres_restore_dumpall_file "${NAME_SPACE}" "${dumpfile}" "postgresql-18"; then
    dump_postgres_diagnostics "${NAME_SPACE}"
    _pg_save_phase_artifacts "${art_pg18}" "PG18 restore failed"
    return 1
  fi
  refresh_postgres_collation_versions "${NAME_SPACE}" 600 "postgresql-18"

  oc rollout restart "deployment/${deploy}" -n "${NAME_SPACE}" || true

  if ! _pg_upgrade_verify_and_test "PG18 after dump/restore" "${art_pg18}" "${url}" "postgresql-18" 900 "${rhdh_uid_before_18}"; then
    return 1
  fi

  log::info "PostgreSQL 15 → 18 Operator Fedora dump/restore sequence completed (Playwright after each major)"
  log::info "Skipping operator RBAC + runtime suites on this evidence PR (showcase-only)"
}
