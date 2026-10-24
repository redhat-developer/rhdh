#!/usr/bin/env bash
# Helm-specific post-deploy recovery helpers.

[[ -n "${_DISCONNECTED_HELM_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_HELM_SOURCED=1

# Helm hub can finish install-dynamic-plugins and start the backend during
# first-boot Postgres initdb. Plugin init then fails with ECONNREFUSED, but
# the process stays up (liveness 200, readiness 503) so kubelet never restarts
# it. Wait for Postgres Ready, then bounce the hub only if it is not Available.
# No-op when the hub becomes Ready after Postgres (typical local timing).
#
# The bounce scales the Deployment to zero and back up instead of using
# `oc rollout restart`: a rolling restart keeps the old pod serving while the
# new one starts, and two backends booting against a freshly initialised
# database race on the knex migration lock ("Migration table is already
# locked"), after which the losing backend never becomes Ready and the rollout
# times out. Scaling to zero guarantees a single backend at a time.
#
# The grace period starts only once the backend container has started, so a pod
# still extracting plugins is not mistaken for a stuck backend.
# Args:
#   $1 - namespace
#   $2 - Helm release name (default: rhdh)
#   $3 - Postgres Ready timeout seconds (default: 600)
#   $4 - Hub Available grace seconds after the backend starts (default: 180)
#   $5 - Hub rollout timeout seconds after restart (default: 420)
disconnected::ensure_helm_hub_after_postgres() {
  local namespace=$1
  local release_name=${2:-rhdh}
  local pg_timeout=${3:-600}
  local hub_grace=${4:-180}
  local rollout_timeout=${5:-420}

  if [[ -z "${namespace}" ]]; then
    log::error "disconnected::ensure_helm_hub_after_postgres requires a namespace"
    return 1
  fi

  local pg_pod="${release_name}-postgresql-0"
  local hub_deploy="${release_name}-developer-hub"
  # Same label the disconnected NetworkPolicies select the backend with.
  local hub_selector="app.kubernetes.io/name=developer-hub"
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

  log::info "Waiting for the hub backend container to start (timeout ${hub_grace}s)..."
  local backend_started=0
  start=$SECONDS
  while ((SECONDS - start < hub_grace)); do
    local backend_state
    backend_state=$(oc get pods -n "${namespace}" -l "${hub_selector}" \
      -o jsonpath='{range .items[*].status.containerStatuses[?(@.name=="backstage-backend")]}{.started}{"\n"}{end}' \
      2> /dev/null || true)
    if grep -q true <<< "${backend_state}"; then
      backend_started=1
      break
    fi
    sleep 5
  done
  if [[ "${backend_started}" -ne 1 ]]; then
    log::warn "Hub backend did not start within ${hub_grace}s; checking deployment availability anyway"
  fi

  if oc wait --for=condition=Available "deployment/${hub_deploy}" \
    -n "${namespace}" --timeout="${hub_grace}s"; then
    log::success "Hub ${hub_deploy} already Available — skipping restart"
    return 0
  fi

  log::warn "Hub ${hub_deploy} not Available after Postgres Ready — restarting to recover from DB connect race"
  oc get pods -n "${namespace}" || true
  if ! oc scale "deployment/${hub_deploy}" --replicas=0 -n "${namespace}"; then
    log::error "Failed to scale deployment/${hub_deploy} down in ${namespace}"
    return 1
  fi
  # Wait for the old pod to be gone before starting the replacement, otherwise
  # both backends initialise at once.
  if ! oc wait --for=delete pod -l "${hub_selector}" -n "${namespace}" --timeout=180s; then
    log::warn "Old hub pods still present after 180s — scaling back up anyway"
  fi
  if ! oc scale "deployment/${hub_deploy}" --replicas=1 -n "${namespace}"; then
    log::error "Failed to scale deployment/${hub_deploy} back up in ${namespace}"
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
