#!/usr/bin/env bash
# Shared SCHEMA_MODE_* exports for pluginDivisionMode schema E2E tests (credentials + port-forward target).
# Playwright starts oc port-forward using SCHEMA_MODE_PORT_FORWARD_*; this script does not bind localhost:5432.
# Prerequisites: caller has sourced "${DIR}/lib/log.sh" and set DIR to .ci/pipelines.

if [[ -n "${SCHEMA_MODE_ENV_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly SCHEMA_MODE_ENV_LIB_SOURCED=1

configure_schema_mode_runtime_env() {
  local runtime_namespace=$1
  local release_name=$2
  local install_kind=${3:-helm}

  if [[ -z "${runtime_namespace}" || -z "${release_name}" ]]; then
    log::error "configure_schema_mode_runtime_env: runtime_namespace and release_name are required"
    return 1
  fi

  local postgres_service=""
  local forward_namespace=""
  local admin_password=""
  local forward_via_pod=0
  local rhdh_psql_svc_name="redhat-developer-hub-postgresql"

  if [[ "${install_kind}" == "operator" ]]; then
    local -a service_candidates=(
      "backstage-psql-${release_name}"
      "rhdh-postgresql"
      "${rhdh_psql_svc_name}"
    )
    local candidate
    for candidate in "${service_candidates[@]}"; do
      if oc get svc "${candidate}" -n "${runtime_namespace}" &> /dev/null; then
        postgres_service="${candidate}"
        forward_namespace="${runtime_namespace}"
        break
      fi
    done

    if [[ -z "${postgres_service}" ]]; then
      log::warn "Schema-mode (${install_kind}): PostgreSQL service not found in ${runtime_namespace}; schema tests remain opt-in."
      return 1
    fi

    local -a secret_candidates=("postgres-cred" "rhdh-postgresql" "${rhdh_psql_svc_name}")
    local sec
    for sec in "${secret_candidates[@]}"; do
      if ! oc get secret "${sec}" -n "${runtime_namespace}" &> /dev/null; then
        continue
      fi
      admin_password=$(oc get secret "${sec}" -n "${runtime_namespace}" -o jsonpath='{.data.postgres-password}' 2> /dev/null | base64 -d || true)
      if [[ -z "${admin_password}" ]]; then
        admin_password=$(oc get secret "${sec}" -n "${runtime_namespace}" -o jsonpath='{.data.POSTGRES_PASSWORD}' 2> /dev/null | base64 -d || true)
      fi
      if [[ -n "${admin_password}" ]]; then
        break
      fi
    done

    if [[ -z "${admin_password}" ]]; then
      log::warn "Schema-mode (${install_kind}): unable to resolve PostgreSQL admin password in ${runtime_namespace}; schema tests remain opt-in."
      return 1
    fi
  else
    local -a helm_svc_candidates=(
      "${release_name}-postgresql"
      "${rhdh_psql_svc_name}"
    )
    local hsvc
    for hsvc in "${helm_svc_candidates[@]}"; do
      if oc get svc "${hsvc}" -n "${runtime_namespace}" &> /dev/null; then
        postgres_service="${hsvc}"
        forward_namespace="${runtime_namespace}"
        break
      fi
    done

    if [[ -n "${postgres_service}" ]]; then
      local -a secret_candidates=(
        "${release_name}-postgresql"
        "${rhdh_psql_svc_name}"
        "postgres-cred"
      )
      local sec
      for sec in "${secret_candidates[@]}"; do
        if ! oc get secret "${sec}" -n "${runtime_namespace}" &> /dev/null; then
          continue
        fi
        admin_password=$(oc get secret "${sec}" -n "${runtime_namespace}" -o jsonpath='{.data.postgres-password}' 2> /dev/null | base64 -d || true)
        if [[ -z "${admin_password}" ]]; then
          admin_password=$(oc get secret "${sec}" -n "${runtime_namespace}" -o jsonpath='{.data.POSTGRES_PASSWORD}' 2> /dev/null | base64 -d || true)
        fi
        if [[ -n "${admin_password}" ]]; then
          break
        fi
      done
    else
      local pdb="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"
      local crunchy_cluster="${SCHEMA_MODE_CRUNCHY_CLUSTER_NAME:-postgress-external-db}"
      if oc get svc postgress-external-db-primary -n "${pdb}" &> /dev/null; then
        forward_namespace="${pdb}"
        log::info "Schema-mode (helm): no in-cluster Postgres Service in ${runtime_namespace}; using Crunchy cluster in ${pdb}"
        local crunchy_admin_secret="${crunchy_cluster}-pguser-postgres"
        if oc get secret "${crunchy_admin_secret}" -n "${pdb}" &> /dev/null; then
          admin_password=$(oc get secret "${crunchy_admin_secret}" -n "${pdb}" -o jsonpath='{.data.password}' 2> /dev/null | base64 -d || true)
        fi
        if [[ -z "${admin_password}" ]]; then
          log::warn "Schema-mode (helm): could not read ${crunchy_admin_secret} password in ${pdb}; schema tests remain opt-in."
          return 1
        fi
        postgres_service=$(oc get pods -n "${pdb}" \
          -l "postgres-operator.crunchydata.com/cluster=${crunchy_cluster},postgres-operator.crunchydata.com/data=postgres" \
          --field-selector=status.phase=Running \
          -o jsonpath='{.items[0].metadata.name}' 2> /dev/null)
        if [[ -z "${postgres_service}" ]]; then
          log::warn "Schema-mode (helm): no Running Postgres pod in ${pdb} for cluster ${crunchy_cluster}; schema tests remain opt-in."
          return 1
        fi
        forward_via_pod=1
      else
        log::warn "Schema-mode (helm): PostgreSQL service not found in ${runtime_namespace} and no postgress-external-db-primary in ${pdb}; schema tests remain opt-in."
        return 1
      fi
    fi

    if [[ -z "${admin_password}" ]]; then
      log::warn "Schema-mode (helm): unable to resolve PostgreSQL admin password; schema tests remain opt-in."
      return 1
    fi
  fi

  local pf_target
  if [[ "${forward_via_pod}" -eq 1 ]]; then
    pf_target="pod/${postgres_service}"
  else
    pf_target="svc/${postgres_service}"
  fi

  export SCHEMA_MODE_PORT_FORWARD_NAMESPACE="${forward_namespace}"
  export SCHEMA_MODE_PORT_FORWARD_RESOURCE="${pf_target}"
  export SCHEMA_MODE_DB_ADMIN_USER="${SCHEMA_MODE_DB_ADMIN_USER:-postgres}"
  export SCHEMA_MODE_DB_ADMIN_PASSWORD="${admin_password}"
  export SCHEMA_MODE_DB_PASSWORD="${SCHEMA_MODE_DB_PASSWORD:-test_password_123}"

  if [[ "${install_kind}" == "operator" ]]; then
    export SCHEMA_MODE_DB_USER="${SCHEMA_MODE_DB_USER:-backstage_schema_user}"
  else
    export SCHEMA_MODE_DB_USER="${SCHEMA_MODE_DB_USER:-bn_backstage}"
  fi

  log::info "Schema-mode env configured (${install_kind}): Playwright will port-forward ${pf_target} in ${forward_namespace}"
}
