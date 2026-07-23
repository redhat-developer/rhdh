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

# Wait for expected Postgres image + Backstage health after a helm upgrade hop.
_pg_upgrade_verify_hop() {
  local label=$1
  local artifacts_subdir=$2
  local url=$3
  local expected_image_substr=$4
  local max_wait=${5:-600}

  if ! wait_for_postgres_ready "${NAME_SPACE}" "${max_wait}" "${expected_image_substr}" > /dev/null; then
    log::error "PostgreSQL not Ready after ${label}"
    return 1
  fi
  log_postgres_version "${NAME_SPACE}"

  oc rollout status deployment/"${RELEASE_NAME}-developer-hub" -n "${NAME_SPACE}" --timeout=10m \
    || log::warn "Backstage rollout status check timed out after ${label}"

  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts_subdir}" 40 30; then
    log::error "Backstage not healthy after ${label}"
    dump_postgres_diagnostics "${NAME_SPACE}"
    return 1
  fi
}

# RHIDP-14594: exercise chart-managed PostgreSQL major upgrades on Fedora images.
# sclorg images only upgrade from POSTGRESQL_PREV_VERSION: 15 -> 16 -> 18.
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

  # Install showcase on fedora/postgresql-15 (product chart default is rhel9/postgresql-15).
  local original_value_file="${HELM_CHART_VALUE_FILE_NAME}"
  HELM_CHART_VALUE_FILE_NAME="values_showcase_15.yaml"
  base_deployment "${PW_PROJECT_SHOWCASE}"
  HELM_CHART_VALUE_FILE_NAME="${original_value_file}"

  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local artifacts="${PW_PROJECT_SHOWCASE}"

  log::info "Baseline: fedora/postgresql-15"
  if ! _pg_upgrade_verify_hop "PG15 baseline" "${artifacts}-pg15" "${url}" "postgresql-15" 600; then
    return 1
  fi

  log::info "Hop A: PostgreSQL 15 -> 16 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 900 "postgresql-16"
  if ! _pg_upgrade_verify_hop "PG 15->16 upgrade" "${artifacts}-pg16-upgrade" "${url}" "postgresql-16" 900; then
    return 1
  fi
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16.yaml"
  if ! _pg_upgrade_verify_hop "PG16 steady-state" "${artifacts}-pg16" "${url}" "postgresql-16" 600; then
    return 1
  fi

  log::info "Hop B: PostgreSQL 16 -> 18 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 900 "postgresql-18"
  if ! _pg_upgrade_verify_hop "PG 16->18 upgrade" "${artifacts}-pg18-upgrade" "${url}" "postgresql-18" 900; then
    return 1
  fi
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18.yaml"
  if ! _pg_upgrade_verify_hop "PG18 steady-state" "${artifacts}-pg18" "${url}" "postgresql-18" 600; then
    return 1
  fi

  log::info "Running showcase Playwright suite against PostgreSQL 18"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"

  log::info "PostgreSQL 15 -> 16 -> 18 Helm upgrade sequence completed"
}
