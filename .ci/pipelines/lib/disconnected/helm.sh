#!/usr/bin/env bash
# Helm-specific post-deploy recovery helpers.

[[ -n "${_DISCONNECTED_HELM_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_HELM_SOURCED=1

# Helm hub can finish install-dynamic-plugins and start the backend during
# first-boot Postgres initdb. Plugin init then fails with ECONNREFUSED, but
# the process stays up (liveness 200, readiness 503) so kubelet never restarts
# it. Wait for Postgres Ready, then bounce the hub only if it is not Available.
# No-op when the hub becomes Ready after Postgres (typical local timing).
# Args:
#   $1 - namespace
#   $2 - Helm release name (default: rhdh)
#   $3 - Postgres Ready timeout seconds (default: 600)
#   $4 - Hub Available grace seconds before restart (default: 30)
#   $5 - Hub rollout timeout seconds after restart (default: 300)
disconnected::ensure_helm_hub_after_postgres() {
  local namespace=$1
  local release_name=${2:-rhdh}
  local pg_timeout=${3:-600}
  local hub_grace=${4:-30}
  local rollout_timeout=${5:-300}

  if [[ -z "${namespace}" ]]; then
    log::error "disconnected::ensure_helm_hub_after_postgres requires a namespace"
    return 1
  fi

  local pg_pod="${release_name}-postgresql-0"
  local hub_deploy="${release_name}-developer-hub"
  local pg_ready=0
  local start=$SECONDS

  log::info "Waiting for ${pg_pod} Ready (timeout ${pg_timeout}s)..."
  while ((SECONDS - start < pg_timeout)); do
    if oc get "pod/${pg_pod}" -n "${namespace}" > /dev/null 2>&1; then
      if oc wait --for=condition=Ready "pod/${pg_pod}" -n "${namespace}" --timeout=15s; then
        log::success "PostgreSQL ${pg_pod} is Ready"
        pg_ready=1
        break
      fi
    else
      log::info "${pg_pod} not created yet"
      sleep 5
    fi
  done
  if [[ "${pg_ready}" -ne 1 ]]; then
    log::error "PostgreSQL ${pg_pod} not Ready after ${pg_timeout}s"
    oc get pods -n "${namespace}" || true
    oc logs "pod/${pg_pod}" -n "${namespace}" --tail=80 || true
    return 1
  fi

  if oc wait --for=condition=Available "deployment/${hub_deploy}" \
    -n "${namespace}" --timeout="${hub_grace}s"; then
    log::success "Hub ${hub_deploy} already Available — skipping restart"
    return 0
  fi

  log::warn "Hub ${hub_deploy} not Available after Postgres Ready — restarting to recover from DB connect race"
  oc get pods -n "${namespace}" || true
  local -a hub_pods=()
  mapfile -t hub_pods < <(oc get pod -n "${namespace}" \
    -l "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=${release_name}" \
    -o name 2> /dev/null || true)
  if [[ ${#hub_pods[@]} -eq 0 || -z "${hub_pods[0]:-}" ]]; then
    log::error "No hub pods matched app.kubernetes.io/component=backstage in ${namespace}"
    return 1
  fi
  if ! oc delete -n "${namespace}" "${hub_pods[@]}"; then
    log::error "Failed to delete hub pods in ${namespace}"
    return 1
  fi
  if ! oc rollout status "deployment/${hub_deploy}" -n "${namespace}" --timeout="${rollout_timeout}s"; then
    log::error "Hub ${hub_deploy} did not become Available after restart"
    oc get pods -n "${namespace}" || true
    oc logs "deployment/${hub_deploy}" -n "${namespace}" --tail=80 --all-containers=true || true
    return 1
  fi
  log::success "Hub ${hub_deploy} Available after restart"
}
