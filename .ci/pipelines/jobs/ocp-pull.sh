#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/lib/helm.sh
source "$DIR"/lib/helm.sh
# shellcheck source=.ci/pipelines/lib/postgres.sh
source "$DIR"/lib/postgres.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

# Wait for Postgres + Backstage, run Playwright, always persist artifacts under a unique subdir.
# Args:
#   $1 - label (log/diagnostics)
#   $2 - artifacts_subdir under ARTIFACT_DIR (must be unique per hop)
#   $3 - url
#   $4 - expected postgres image substring (e.g. postgresql-16)
#   $5 - optional max wait seconds (default: 600)
#   $6 - optional previous RHDH pod UID (wait for terminate + new Ready pod)
#   $7 - optional "seed" to register persistence-proof catalog entity before Playwright
_pg_upgrade_verify_and_test() {
  local label=$1
  local artifacts_subdir=$2
  local url=$3
  local expected_image_substr=$4
  local max_wait=${5:-600}
  local previous_rhdh_uid=${6:-}
  local seed_data=${7:-}

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

  oc rollout status deployment/"${RELEASE_NAME}-developer-hub" -n "${NAME_SPACE}" --timeout=10m \
    || log::warn "Backstage rollout status check timed out after ${label}"

  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts_subdir}" 40 30; then
    log::error "Backstage not healthy after ${label}"
    dump_postgres_diagnostics "${NAME_SPACE}"
    _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"
    return 1
  fi

  if [[ "${seed_data}" == "seed" ]]; then
    # Public GitHub catalog URL (in-cluster *.svc targets are blocked by Backstage URL reader).
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

  # Enable UI verification of the seeded catalog entity in Playwright.
  export PG_UPGRADE_DATA_PROOF=1

  # check_and_test always returns 0; Playwright failures are recorded via save_overall_result.
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}" "" "" "${artifacts_subdir}"

  # Always store pod logs + postgres diagnostics for this hop (unique subdir; never overwrite).
  _pg_save_phase_artifacts "${artifacts_subdir}" "${label}"

  # Fail fast so later majors do not run Playwright on a contaminated agent
  # (e.g. leftover redis port-forward from a prior phase).
  if [[ "${OVERALL_RESULT:-0}" -ne 0 ]]; then
    log::error "Playwright (or prior step) failed during ${label}; aborting remaining upgrade phases"
    return 1
  fi
}

# Persist pod logs and postgres diagnostics under ARTIFACT_DIR/<artifacts_subdir>/.
_pg_save_phase_artifacts() {
  local artifacts_subdir=$1
  local label=$2
  local diag_file="/tmp/pg-diagnostics-${artifacts_subdir}.txt"

  log::info "Saving phase artifacts for '${label}' → ${ARTIFACT_DIR:-<unset>}/${artifacts_subdir}"
  dump_postgres_diagnostics "${NAME_SPACE}" > "${diag_file}" 2>&1 || true
  common::save_artifact "${artifacts_subdir}" "${diag_file}" "postgres" || true
  save_all_pod_logs "${NAME_SPACE}" "${artifacts_subdir}"
}

# RHIDP-14594: chart-managed PostgreSQL major upgrades on rhel9 images.
# Flow: PG15 → Playwright → PG16 → Playwright → PG18 → Playwright
# Each phase writes to a distinct ARTIFACT_DIR subdir (pod logs + Playwright output).
handle_ocp_pull() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

  log::info "Configuring namespace: ${NAME_SPACE}"
  common::oc_login
  log::info "OCP version: $(oc version)"

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE
  cluster_setup_ocp_helm

  local original_value_file="${HELM_CHART_VALUE_FILE_NAME}"
  HELM_CHART_VALUE_FILE_NAME="values_showcase_15.yaml"
  base_deployment "${PW_PROJECT_SHOWCASE}"
  HELM_CHART_VALUE_FILE_NAME="${original_value_file}"

  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  # Unique artifact roots so Playwright/junit/pod logs from later hops cannot overwrite earlier ones.
  local art_pg15="${PW_PROJECT_SHOWCASE}-pg15"
  local art_pg16="${PW_PROJECT_SHOWCASE}-pg16"
  local art_pg18="${PW_PROJECT_SHOWCASE}-pg18"

  log::info "Phase PG15: rhel9/postgresql-15"
  if ! _pg_upgrade_verify_and_test "PG15 baseline" "${art_pg15}" "${url}" "postgresql-15" 600 "" "seed"; then
    return 1
  fi

  local rhdh_uid_before_16
  rhdh_uid_before_16=$(get_rhdh_pod_uid "${RELEASE_NAME}" "${NAME_SPACE}")
  log::info "RHDH pod uid before PG16 upgrade: ${rhdh_uid_before_16:-<none>}"

  log::info "Phase PG16: upgrade 15 → 16 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 900 "postgresql-16"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16.yaml"
  if ! _pg_upgrade_verify_and_test "PG16 after upgrade" "${art_pg16}" "${url}" "postgresql-16" 900 "${rhdh_uid_before_16}"; then
    return 1
  fi

  local rhdh_uid_before_18
  rhdh_uid_before_18=$(get_rhdh_pod_uid "${RELEASE_NAME}" "${NAME_SPACE}")
  log::info "RHDH pod uid before PG18 upgrade: ${rhdh_uid_before_18:-<none>}"

  log::info "Phase PG18: upgrade 16 → 18 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 900 "postgresql-18"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18.yaml"
  if ! _pg_upgrade_verify_and_test "PG18 after upgrade" "${art_pg18}" "${url}" "postgresql-18" 900 "${rhdh_uid_before_18}"; then
    return 1
  fi

  log::info "PostgreSQL 15 → 16 → 18 Helm upgrade sequence completed (Playwright after each major)"
}
