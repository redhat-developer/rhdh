#!/usr/bin/env bash

# PostgreSQL helpers for chart-managed (internal) database upgrades.
# Dependencies: oc, lib/log.sh

# Prevent re-sourcing
if [[ -n "${POSTGRES_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly POSTGRES_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Refresh PostgreSQL collation versions after a major version upgrade.
# Suppresses "collation version mismatch" warnings that occur when upgrading
# across glibc versions (e.g. Fedora base image jumps).
# Args:
#   $1 - namespace containing the PostgreSQL pod
#   $2 - optional max wait seconds for the pod (default: 120)
refresh_postgres_collation_versions() {
  local namespace=$1
  local max_wait=${2:-120}

  log::info "Refreshing PostgreSQL collation versions in namespace: ${namespace}"

  local pg_pod=""
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    pg_pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=postgresql" -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
    if [[ -n "$pg_pod" ]]; then
      local ready
      ready=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2> /dev/null || true)
      if [[ "$ready" == "True" ]]; then
        break
      fi
    fi
    log::debug "Waiting for PostgreSQL pod to be ready... (${waited}s/${max_wait}s)"
    sleep 5
    waited=$((waited + 5))
  done

  if [[ -z "$pg_pod" ]]; then
    log::warn "No PostgreSQL pod found in namespace ${namespace}. Skipping collation refresh."
    return 0
  fi

  log::info "Found PostgreSQL pod: ${pg_pod}"

  local databases
  databases=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -t -c \
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres');" 2> /dev/null | tr -d ' ' || true)

  log::info "Refreshing collation version for database: postgres"
  oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -c \
    "ALTER DATABASE postgres REFRESH COLLATION VERSION;" 2> /dev/null \
    || log::warn "Failed to refresh collation for postgres"

  log::info "Refreshing collation version for database: template1"
  oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -c \
    "ALTER DATABASE template1 REFRESH COLLATION VERSION;" 2> /dev/null \
    || log::warn "Failed to refresh collation for template1"

  local db
  for db in $databases; do
    if [[ -n "$db" ]]; then
      log::info "Refreshing collation version for database: ${db}"
      oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -c \
        "ALTER DATABASE \"${db}\" REFRESH COLLATION VERSION;" 2> /dev/null \
        || log::warn "Failed to refresh collation for ${db}"
    fi
  done

  log::info "Collation version refresh completed for namespace: ${namespace}"
}
