#!/usr/bin/env bash

# PostgreSQL helpers for chart-managed (internal) database upgrades.
# Dependencies: oc, lib/log.sh
#
# IMPORTANT: functions that print a pod name on stdout (for capture) MUST send
# all diagnostics to stderr, otherwise callers using $(...) swallow the evidence.

# Prevent re-sourcing
if [[ -n "${POSTGRES_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly POSTGRES_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Dump postgres pod diagnostics to stderr (safe under $(...) capture).
# Args:
#   $1 - namespace
dump_postgres_diagnostics() {
  local namespace=$1
  {
    log::info "PostgreSQL diagnostics for namespace: ${namespace}"
    oc get pods,statefulset,pvc -n "${namespace}" -l "app.kubernetes.io/name=postgresql" -o wide 2>&1 || true
    oc get pods -n "${namespace}" -o wide 2>&1 | head -40 || true
    local pg_pod
    pg_pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=postgresql" -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
    if [[ -z "$pg_pod" ]]; then
      log::warn "No postgresql-labeled pod; listing all pods containing 'postgres'"
      oc get pods -n "${namespace}" 2>&1 | grep -i postgres || true
      return 0
    fi
    log::info "Pod image/status for ${pg_pod}:"
    oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='image={.spec.containers[0].image} phase={.status.phase} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}' 2>&1 || true
    log::info "Describe pod ${pg_pod}:"
    oc describe pod -n "${namespace}" "${pg_pod}" 2>&1 | tail -100 || true
    log::info "Logs for ${pg_pod} (current):"
    oc logs -n "${namespace}" "${pg_pod}" --tail=200 2>&1 || true
    log::info "Logs for ${pg_pod} (previous):"
    oc logs -n "${namespace}" "${pg_pod}" --previous --tail=200 2>&1 || true
    log::info "Helm values snapshot (postgresql image):"
    helm get values rhdh -n "${namespace}" 2>&1 | grep -A20 -E 'postgresql:|^  image:' || true
  } >&2
}

# Wait until PostgreSQL is Ready and (optionally) running an expected image substring.
# Args:
#   $1 - namespace
#   $2 - optional max wait seconds (default: 600)
#   $3 - optional image substring that must appear in the container image
# Prints the pod name on success; returns 1 on timeout.
wait_for_postgres_ready() {
  local namespace=$1
  local max_wait=${2:-600}
  local expected_image_substr=${3:-}
  local pg_pod=""
  local waited=0

  if [[ -n "${expected_image_substr}" ]]; then
    log::info "Waiting for PostgreSQL Ready with image containing '${expected_image_substr}' in ${namespace}"
  else
    log::info "Waiting for PostgreSQL pod to be Ready in namespace: ${namespace}"
  fi

  while [[ $waited -lt $max_wait ]]; do
    pg_pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=postgresql" -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
    if [[ -n "$pg_pod" ]]; then
      local phase ready image sts_ready
      phase=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.status.phase}' 2> /dev/null || true)
      ready=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2> /dev/null || true)
      image=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.spec.containers[0].image}' 2> /dev/null || true)
      sts_ready=$(oc get statefulset -n "${namespace}" -l "app.kubernetes.io/name=postgresql" -o jsonpath='{.items[0].status.readyReplicas}' 2> /dev/null || true)

      # Periodic progress on INFO so CI logs show what we are waiting for.
      if ((waited % 60 == 0)); then
        log::info "Still waiting… pod=${pg_pod:-none} phase=${phase:-?} ready=${ready:-?} sts_ready=${sts_ready:-0} image=${image:-?} (${waited}s/${max_wait}s)"
      fi

      if [[ -n "${expected_image_substr}" && "${image}" != *"${expected_image_substr}"* ]]; then
        :
      elif [[ "$phase" == "Running" && "$ready" == "True" && "${sts_ready:-0}" -ge 1 ]]; then
        log::info "PostgreSQL pod is Ready: ${pg_pod} (image=${image})"
        echo "${pg_pod}"
        return 0
      fi
    elif ((waited % 60 == 0)); then
      log::info "Still waiting… no postgresql pod yet (${waited}s/${max_wait}s)"
      oc get pods -n "${namespace}" -o wide >&2 || true
    fi
    sleep 10
    waited=$((waited + 10))
  done

  log::error "PostgreSQL pod not Ready in namespace ${namespace} after ${max_wait}s"
  dump_postgres_diagnostics "${namespace}"
  return 1
}

# Log the running PostgreSQL server version (for upgrade evidence).
log_postgres_version() {
  local namespace=$1
  local pg_pod=${2:-}

  if [[ -z "$pg_pod" ]]; then
    pg_pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=postgresql" -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
  fi
  if [[ -z "$pg_pod" ]]; then
    log::warn "Cannot log PostgreSQL version: no pod found in ${namespace}"
    return 0
  fi

  local version
  version=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -t -A -c "SHOW server_version;" 2> /dev/null | tr -d '[:space:]' || true)
  local image
  image=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.spec.containers[0].image}' 2> /dev/null || true)
  log::info "PostgreSQL evidence — version='${version:-unknown}' image='${image:-unknown}' pod='${pg_pod}'"
}

# Refresh PostgreSQL collation versions after a major version upgrade.
# Args:
#   $1 - namespace
#   $2 - optional max wait seconds (default: 600)
#   $3 - optional expected image substring (e.g. postgresql-18)
refresh_postgres_collation_versions() {
  local namespace=$1
  local max_wait=${2:-600}
  local expected_image_substr=${3:-}

  log::info "Refreshing PostgreSQL collation versions in namespace: ${namespace}"

  local pg_pod
  if ! pg_pod=$(wait_for_postgres_ready "${namespace}" "${max_wait}" "${expected_image_substr}"); then
    log::warn "Skipping collation refresh; PostgreSQL not Ready."
    return 0
  fi

  log::info "Found PostgreSQL pod: ${pg_pod}"

  # Keep stderr separate so WARNING/DETAIL/HINT lines are not treated as DB names.
  local databases
  databases=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -t -A -c \
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres');" 2> /dev/null \
    | grep -E '^[A-Za-z0-9_.:-]+$' || true)
  log::info "User databases for collation refresh: ${databases:-<none>}"

  local db out
  for db in postgres template1 $databases; do
    if [[ -z "$db" ]]; then
      continue
    fi
    log::info "Refreshing collation version for database: ${db}"
    out=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -v ON_ERROR_STOP=1 -c \
      "ALTER DATABASE \"${db}\" REFRESH COLLATION VERSION;" 2>&1) \
      && log::debug "${out}" \
      || log::warn "Failed to refresh collation for ${db}: ${out}"
  done

  log::info "Collation version refresh completed for namespace: ${namespace}"
}

# Dump all databases from the chart-managed PostgreSQL (for dump/restore upgrades).
# Args:
#   $1 - namespace
#   $2 - output file path
postgres_dumpall_to_file() {
  local namespace=$1
  local outfile=$2
  local pg_pod

  if ! pg_pod=$(wait_for_postgres_ready "${namespace}" 300); then
    log::error "Cannot dumpall: PostgreSQL not Ready in ${namespace}"
    return 1
  fi

  log::info "Running pg_dumpall from ${pg_pod} → ${outfile}"
  mkdir -p "$(dirname "${outfile}")"
  if ! oc exec -n "${namespace}" "${pg_pod}" -- pg_dumpall -U postgres > "${outfile}"; then
    log::error "pg_dumpall failed"
    return 1
  fi
  log::info "pg_dumpall wrote $(wc -c < "${outfile}" | tr -d ' ') bytes"
}

# Wipe the chart-managed Postgres PVC so the next helm install can initdb fresh.
# Args:
#   $1 - namespace
postgres_wipe_persistent_volume() {
  local namespace=$1

  log::info "Wiping PostgreSQL StatefulSet + PVC in ${namespace} for dump/restore upgrade"
  oc delete statefulset -n "${namespace}" -l "app.kubernetes.io/name=postgresql" --wait=true --timeout=5m 2>&1 || true
  oc delete pod -n "${namespace}" -l "app.kubernetes.io/name=postgresql" --force --grace-period=0 2>&1 || true

  local pvc
  pvc=$(oc get pvc -n "${namespace}" -o name 2> /dev/null | grep -i postgres | head -1 || true)
  if [[ -n "${pvc}" ]]; then
    log::info "Deleting ${pvc}"
    oc delete -n "${namespace}" "${pvc}" --wait=true --timeout=5m 2>&1 || true
  else
    log::warn "No postgres PVC found to delete"
  fi
}

# Restore a pg_dumpall file into a Ready PostgreSQL pod.
# Args:
#   $1 - namespace
#   $2 - dump file path
#   $3 - optional expected image substring
postgres_restore_dumpall_file() {
  local namespace=$1
  local dumpfile=$2
  local expected_image_substr=${3:-}
  local pg_pod

  if ! pg_pod=$(wait_for_postgres_ready "${namespace}" 600 "${expected_image_substr}"); then
    log::error "Cannot restore: PostgreSQL not Ready in ${namespace}"
    return 1
  fi

  log::info "Restoring pg_dumpall into ${pg_pod} from ${dumpfile}"
  # Ignore benign "already exists" errors from globals/roles created by image init.
  if ! oc exec -i -n "${namespace}" "${pg_pod}" -- psql -U postgres -v ON_ERROR_STOP=0 < "${dumpfile}"; then
    log::error "psql restore failed"
    return 1
  fi
  log::info "pg_dumpall restore completed"
}
