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
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"

  log::info "Hop A: PostgreSQL 15 -> 16 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 300
  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts}-pg16-upgrade" 40 30; then
    log::error "Backstage not healthy after PG 15->16 upgrade hop"
    return 1
  fi
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_16.yaml"
  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts}-pg16" 40 30; then
    log::error "Backstage not healthy after PG 16 steady-state"
    return 1
  fi

  log::info "Hop B: PostgreSQL 16 -> 18 (POSTGRESQL_UPGRADE=copy)"
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18_upgrade.yaml"
  refresh_postgres_collation_versions "${NAME_SPACE}" 300
  if ! testing::check_backstage_running "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" "${artifacts}-pg18-upgrade" 40 30; then
    log::error "Backstage not healthy after PG 16->18 upgrade hop"
    return 1
  fi
  helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "values_showcase_18.yaml"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"

  log::info "PostgreSQL 15 -> 16 -> 18 Helm upgrade sequence completed"
}
