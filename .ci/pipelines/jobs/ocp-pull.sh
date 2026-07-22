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

# Wait for PostgreSQL Ready and Backstage HTTP health after a helm upgrade hop.
_pg_upgrade_verify_hop() {
  local label=$1
  local artifacts_subdir=$2
  local url=$3

  if ! wait_for_postgres_ready "${NAME_SPACE}" 300 > /dev/null; then
    log::error "PostgreSQL not Ready after ${label}"
    return 1
  fi
  log_postgres_version "${NAME_SPACE}"

  # Give the Backstage deployment time to finish rolling after DB restart.
  oc rollout status deployment/"${RELEASE_NAME}-developer-hub" -n "${NAME_SPACE}" --timeout=10m \
    || log::warn "Backstage rollout status check timed out after ${label}"

  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts_subdir}" 40 30; then
    log::error "Backstage not healthy after ${label}"
    return 1
  fi
}

# RHIDP-14594: exercise chart-managed PostgreSQL major upgrades.
# sclorg Fedora images only upgrade from POSTGRESQL_PREV_VERSION, so the
# supported path is 15 -> 16 -> 18 (no Fedora postgresql-17 image).
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
  # Showcase only for PG upgrade evidence (skip RBAC / external DB path).
  base_deployment "${PW_PROJECT_SHOWCASE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local artifacts="${PW_PROJECT_SHOWCASE}"

  log::info "Baseline: chart-default PostgreSQL (fedora/postgresql-15)"
  # Health + version only here; full Playwright runs once after PG18 to avoid
  # leftover port-forwards from a second showcase suite in the same job.
  if ! _pg_upgrade_verify_hop "PG15 baseline" "${artifacts}-pg15" "${url}"; then
    return 1
  fi

  log::info "Hop A: PostgreSQL 15 -> 16 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 300
  if ! _pg_upgrade_verify_hop "PG 15->16 upgrade" "${artifacts}-pg16-upgrade" "${url}"; then
    return 1
  fi
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16.yaml"
  if ! _pg_upgrade_verify_hop "PG16 steady-state" "${artifacts}-pg16" "${url}"; then
    return 1
  fi

  log::info "Hop B: PostgreSQL 16 -> 18 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 300
  if ! _pg_upgrade_verify_hop "PG 16->18 upgrade" "${artifacts}-pg18-upgrade" "${url}"; then
    return 1
  fi
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18.yaml"
  if ! _pg_upgrade_verify_hop "PG18 steady-state" "${artifacts}-pg18" "${url}"; then
    return 1
  fi

  log::info "Running showcase Playwright suite against PostgreSQL 18"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"

  log::info "PostgreSQL 15 -> 16 -> 18 Helm upgrade sequence completed"
}
