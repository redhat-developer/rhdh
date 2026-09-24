#!/usr/bin/env bash

# PostgreSQL helpers for Helm-managed RHDH upgrade tests.
# Dependencies: oc, jq, lib/log.sh

if [[ -n "${POSTGRES_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly POSTGRES_LIB_SOURCED=1

readonly POSTGRES_MIGRATION_PROOF_DATABASE="rhdh_upgrade_test"
readonly POSTGRES_MIGRATION_PROOF_VALUE="postgres-major-upgrade"

postgres::pod_name() {
  local release_name=$1
  echo "${release_name}-postgresql-0"
}

postgres::wait_ready() {
  local namespace=$1
  local release_name=$2
  local expected_major=${3:-}
  local timeout=${4:-600}
  local pod
  pod=$(postgres::pod_name "${release_name}")
  local start=$SECONDS

  log::info "Waiting for PostgreSQL pod ${pod} in ${namespace}"
  while ((SECONDS - start < timeout)); do
    if oc get "pod/${pod}" -n "${namespace}" > /dev/null 2>&1 \
      && oc wait --for=condition=Ready "pod/${pod}" -n "${namespace}" --timeout=15s > /dev/null 2>&1; then
      if [[ -z "${expected_major}" ]]; then
        log::success "PostgreSQL pod ${pod} is Ready"
        return 0
      fi

      local running_major
      running_major=$(postgres::server_major "${namespace}" "${release_name}" 2> /dev/null || true)
      if [[ "${running_major}" == "${expected_major}" ]]; then
        log::success "PostgreSQL ${running_major} pod ${pod} is Ready"
        return 0
      fi
      log::info "PostgreSQL pod ${pod} reports major ${running_major:-unknown}; waiting for ${expected_major}"
    fi
    sleep 5
  done

  log::error "PostgreSQL pod ${pod} did not become Ready after ${timeout}s"
  oc get pods,statefulsets,pvc -n "${namespace}" || true
  oc logs "pod/${pod}" -n "${namespace}" --tail=100 || true
  return 1
}

postgres::server_major() {
  local namespace=$1
  local release_name=$2
  local pod
  pod=$(postgres::pod_name "${release_name}")
  local version_num

  version_num=$(oc exec -n "${namespace}" "${pod}" -- \
    psql -U postgres -tAc "SHOW server_version_num;" | tr -d '[:space:]')
  if [[ ! "${version_num}" =~ ^[0-9]+$ ]]; then
    log::error "PostgreSQL returned invalid server_version_num: ${version_num}"
    return 1
  fi

  echo "$((10#${version_num} / 10000))"
}

postgres::major_from_image_repository() {
  local repository=$1

  if [[ "${repository}" =~ (^|/)postgresql-([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[2]}"
    return 0
  fi

  log::error "Cannot determine PostgreSQL major from image repository: ${repository}"
  return 1
}

postgres::seed_migration_proof() {
  local namespace=$1
  local release_name=$2
  local pod
  pod=$(postgres::pod_name "${release_name}")

  if ! oc exec -n "${namespace}" "${pod}" -- \
    psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_MIGRATION_PROOF_DATABASE}'" \
    | grep -qx 1; then
    oc exec -n "${namespace}" "${pod}" -- createdb -U postgres "${POSTGRES_MIGRATION_PROOF_DATABASE}"
  fi

  oc exec -n "${namespace}" "${pod}" -- \
    psql -U postgres -d "${POSTGRES_MIGRATION_PROOF_DATABASE}" -v ON_ERROR_STOP=1 -c \
    "CREATE TABLE IF NOT EXISTS migration_proof (value text PRIMARY KEY); TRUNCATE migration_proof; INSERT INTO migration_proof VALUES ('${POSTGRES_MIGRATION_PROOF_VALUE}');"
}

postgres::verify_migration_proof() {
  local namespace=$1
  local release_name=$2
  local pod
  pod=$(postgres::pod_name "${release_name}")
  local value

  value=$(oc exec -n "${namespace}" "${pod}" -- \
    psql -U postgres -d "${POSTGRES_MIGRATION_PROOF_DATABASE}" -tAc \
    "SELECT value FROM migration_proof;")
  value=$(echo "${value}" | tr -d '[:space:]')
  if [[ "${value}" != "${POSTGRES_MIGRATION_PROOF_VALUE}" ]]; then
    log::error "PostgreSQL migration proof was not restored"
    return 1
  fi

  log::success "PostgreSQL migration proof was restored"
}

postgres::quiesce_application() {
  local namespace=$1
  local deployment_name=$2
  local timeout=${3:-300}
  local start=$SECONDS
  local selector

  selector=$(oc get "deployment/${deployment_name}" -n "${namespace}" -o json \
    | jq -r '.spec.selector.matchLabels | to_entries | map("\(.key)=\(.value)") | join(",")')
  if [[ -z "${selector}" ]]; then
    log::error "Deployment ${deployment_name} has no pod selector"
    return 1
  fi

  log::info "Scaling deployment/${deployment_name} to zero before PostgreSQL dump"
  oc scale "deployment/${deployment_name}" -n "${namespace}" --replicas=0

  while ((SECONDS - start < timeout)); do
    local replicas
    if replicas=$(oc get "deployment/${deployment_name}" -n "${namespace}" -o jsonpath='{.status.replicas}' 2> /dev/null); then
      if [[ "${replicas:-0}" == "0" ]]; then
        local remaining=$((timeout - (SECONDS - start)))
        if ((remaining <= 0)); then
          break
        fi
        local selected_pods
        if ! selected_pods=$(oc get pods -l "${selector}" -n "${namespace}" -o name); then
          log::warn "Failed to list pods for deployment ${deployment_name}; retrying"
          sleep 5
          continue
        fi
        if [[ -z "${selected_pods}" ]]; then
          log::success "Deployment ${deployment_name} is quiesced"
          return 0
        fi
        if oc wait --for=delete pod -l "${selector}" -n "${namespace}" --timeout="${remaining}s"; then
          log::success "Deployment ${deployment_name} is quiesced"
          return 0
        fi
        break
      fi
    fi
    sleep 5
  done

  log::error "Deployment ${deployment_name} did not scale to zero after ${timeout}s"
  return 1
}

postgres::dump_all() {
  local namespace=$1
  local release_name=$2
  local dump_file=$3
  local pod
  pod=$(postgres::pod_name "${release_name}")

  log::info "Dumping all PostgreSQL databases"
  oc exec -n "${namespace}" "${pod}" -- pg_dumpall -U postgres > "${dump_file}"
  if [[ ! -s "${dump_file}" ]]; then
    log::error "PostgreSQL dump is empty"
    return 1
  fi
  chmod 600 "${dump_file}"
}

postgres::remove_data_volume() {
  local namespace=$1
  local release_name=$2
  local pod
  pod=$(postgres::pod_name "${release_name}")
  local statefulset="${release_name}-postgresql"
  local -a claims

  mapfile -t claims < <(oc get "pod/${pod}" -n "${namespace}" -o json \
    | jq -r '.spec.volumes[] | .persistentVolumeClaim.claimName // empty')
  if [[ ${#claims[@]} -eq 0 ]]; then
    log::error "No persistent volume claims found on PostgreSQL pod ${pod}"
    return 1
  fi

  log::info "Deleting PostgreSQL StatefulSet ${statefulset}"
  oc delete "statefulset/${statefulset}" -n "${namespace}" --wait=true --timeout=5m

  local claim
  for claim in "${claims[@]}"; do
    log::info "Deleting PostgreSQL PVC ${claim}"
    oc delete "pvc/${claim}" -n "${namespace}" --wait=true --timeout=5m
    if oc get "pvc/${claim}" -n "${namespace}" > /dev/null 2>&1; then
      log::error "PostgreSQL PVC ${claim} still exists"
      return 1
    fi
  done
}

postgres::restore_all() {
  local namespace=$1
  local release_name=$2
  local dump_file=$3
  local pod
  pod=$(postgres::pod_name "${release_name}")
  local restore_log="${dump_file}.restore.log"
  local restore_status=0

  log::info "Restoring all PostgreSQL databases"
  # A fresh cluster already contains the postgres role and database. Continue
  # past those expected duplicate-object errors, but reject any other SQL error.
  oc exec -i -n "${namespace}" "${pod}" -- \
    env LC_ALL=C psql -U postgres -v ON_ERROR_STOP=0 < "${dump_file}" > "${restore_log}" 2>&1 \
    || restore_status=$?

  # Keep failed restore logs for upgrade failure artifacts; cleanup removes them.
  if [[ ${restore_status} -ne 0 ]]; then
    log::error "PostgreSQL restore command failed with status ${restore_status}"
    grep -E 'ERROR:|FATAL:' "${restore_log}" || true
    return 1
  fi

  local unexpected_errors
  unexpected_errors=$(grep -E 'ERROR:' "${restore_log}" \
    | grep -Ev 'ERROR: +(role|database) "postgres" already exists$' || true)
  if [[ -n "${unexpected_errors}" ]]; then
    log::error "PostgreSQL restore reported unexpected SQL errors:"
    echo "${unexpected_errors}"
    return 1
  fi

  rm -f "${restore_log}"
}

postgres::refresh_collation_versions() {
  local namespace=$1
  local release_name=$2
  local pod
  pod=$(postgres::pod_name "${release_name}")
  local -a databases
  local database_output

  if ! database_output=$(oc exec -n "${namespace}" "${pod}" -- \
    psql -U postgres -tAc "SELECT datname FROM pg_database WHERE datallowconn AND datname <> 'template0' ORDER BY datname;"); then
    log::error "Failed to list PostgreSQL databases for collation refresh"
    return 1
  fi
  mapfile -t databases <<< "${database_output}"
  if [[ ${#databases[@]} -eq 0 || -z "${database_output//[[:space:]]/}" ]]; then
    log::error "PostgreSQL returned no databases for collation refresh"
    return 1
  fi

  local database escaped_database
  for database in "${databases[@]}"; do
    database=$(echo "${database}" | xargs)
    [[ -z "${database}" ]] && continue
    escaped_database=${database//\"/\"\"}
    oc exec -n "${namespace}" "${pod}" -- \
      psql -U postgres -d "${database}" -v ON_ERROR_STOP=1 -c \
      "ALTER DATABASE \"${escaped_database}\" REFRESH COLLATION VERSION;"
  done
}
