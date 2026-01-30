#!/usr/bin/env bash

# Kubernetes/OpenShift resource waiting and polling utilities
# Dependencies: oc, kubectl, lib/log.sh

# Prevent re-sourcing
if [[ -n "${K8S_WAIT_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly K8S_WAIT_LIB_SOURCED=1

# Constants
readonly ERR_MISSING_PARAMS="Missing required parameters"

# Wait for deployment to become ready
# Args: namespace, resource_name, timeout_minutes (default: 5), check_interval_seconds (default: 10)
k8s_wait::deployment() {
  local namespace=$1
  local resource_name=$2
  local timeout_minutes=${3:-5}
  local check_interval=${4:-10}

  if [[ -z "$namespace" || -z "$resource_name" ]]; then
    log::error "${ERR_MISSING_PARAMS}"
    log::info "Usage: k8s_wait::deployment <namespace> <resource-name> [timeout_minutes] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout_minutes * 60 / check_interval))

  log::info "Waiting for resource '$resource_name' in namespace '$namespace' (timeout: ${timeout_minutes}m)..."

  for ((i = 1; i <= max_attempts; i++)); do
    # Get the first pod name matching the resource name (grep-based, same as original)
    local pod_name
    pod_name=$(oc get pods -n "$namespace" 2> /dev/null | grep "$resource_name" | awk '{print $1}' | head -n 1)

    if [[ -n "$pod_name" ]]; then
      local phase ready
      phase=$(oc get pod "$pod_name" -n "$namespace" -o jsonpath='{.status.phase}' 2> /dev/null || echo "")
      ready=$(oc get pod "$pod_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2> /dev/null || echo "")

      if [[ "$phase" == "Running" && "$ready" == "True" ]]; then
        log::success "Resource '$resource_name' is ready in namespace '$namespace'"
        return 0
      fi

      log::debug "Pod '$pod_name' phase=$phase ready=$ready"
    else
      log::debug "No pods found matching '$resource_name' in '$namespace'"
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for resource '$resource_name' in namespace '$namespace' after ${timeout_minutes} minutes"
      log::info "Collecting diagnostic information..."

      # Show pod status
      log::info "Pod status:"
      oc get pods -n "$namespace" | grep "$resource_name" || log::warn "No pods found"

      # Show pod description if pod exists
      if [[ -n "$pod_name" ]]; then
        log::info "Pod description (last 30 lines):"
        oc describe pod "$pod_name" -n "$namespace" | tail -30

        log::info "Pod logs (last 50 lines):"
        oc logs "$pod_name" -n "$namespace" --tail=50 2>&1 || log::warn "Could not retrieve logs"
      fi

      # Show recent events
      log::info "Recent events in namespace:"
      oc get events -n "$namespace" --sort-by='.lastTimestamp' | grep "$resource_name" | tail -10 || log::warn "No events found"

      return 1
    fi

    log::debug "Attempt $i/$max_attempts - Waiting ${check_interval}s..."
    sleep "$check_interval"
  done

  return 1
}

# Wait for Kubernetes job to complete
# Args: namespace, job_name, timeout_minutes (default: 5), check_interval_seconds (default: 10)
k8s_wait::job() {
  local namespace=$1
  local job_name=$2
  local timeout_minutes=${3:-5}
  local check_interval=${4:-10}

  if [[ -z "$namespace" || -z "$job_name" ]]; then
    log::error "${ERR_MISSING_PARAMS}"
    log::info "Usage: k8s_wait::job <namespace> <job-name> [timeout_minutes] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout_minutes * 60 / check_interval))

  log::info "Waiting for job '$job_name' in namespace '$namespace' (timeout: ${timeout_minutes}m)..."

  for ((i = 1; i <= max_attempts; i++)); do
    if ! kubectl get job "$job_name" -n "$namespace" &> /dev/null; then
      log::error "Job '$job_name' not found in namespace '$namespace'"
      return 1
    fi

    local job_status
    job_status=$(kubectl get job "$job_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}')

    if [[ "$job_status" == "True" ]]; then
      log::success "Job '$job_name' completed successfully in namespace '$namespace'"
      return 0
    fi

    local failed_status
    failed_status=$(kubectl get job "$job_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}')

    if [[ "$failed_status" == "True" ]]; then
      log::error "Job '$job_name' failed in namespace '$namespace'"
      kubectl describe job "$job_name" -n "$namespace"
      return 1
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for job '$job_name' in namespace '$namespace' after ${timeout_minutes} minutes"
      kubectl describe job "$job_name" -n "$namespace"
      return 1
    fi

    log::debug "Attempt $i/$max_attempts - Waiting ${check_interval}s..."
    sleep "$check_interval"
  done

  return 1
}

# Wait for service to become available
# Args: service_name, namespace, timeout_seconds (default: 60), check_interval_seconds (default: 5)
k8s_wait::service() {
  local service_name=$1
  local namespace=$2
  local timeout=${3:-60}
  local check_interval=${4:-5}

  if [[ -z "$service_name" || -z "$namespace" ]]; then
    log::error "${ERR_MISSING_PARAMS}"
    log::info "Usage: k8s_wait::service <service-name> <namespace> [timeout_seconds] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout / check_interval))

  log::info "Waiting for service '$service_name' in namespace '$namespace' (timeout: ${timeout}s)..."

  for ((i = 1; i <= max_attempts; i++)); do
    if kubectl get svc "$service_name" -n "$namespace" &> /dev/null; then
      log::success "Service '$service_name' is available in namespace '$namespace'"
      return 0
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for service '$service_name' in namespace '$namespace' after ${timeout} seconds"
      return 1
    fi

    log::debug "Attempt $i/$max_attempts - Waiting ${check_interval}s..."
    sleep "$check_interval"
  done

  return 1
}

# Wait for service endpoint to become available
# Args: service_name, namespace, timeout_seconds (default: 60), check_interval_seconds (default: 5)
k8s_wait::endpoint() {
  local service_name=$1
  local namespace=$2
  local timeout=${3:-60}
  local check_interval=${4:-5}

  if [[ -z "$service_name" || -z "$namespace" ]]; then
    log::error "${ERR_MISSING_PARAMS}"
    log::info "Usage: k8s_wait::endpoint <service-name> <namespace> [timeout_seconds] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout / check_interval))

  log::info "Waiting for endpoint '$service_name' in namespace '$namespace' (timeout: ${timeout}s)..."

  for ((i = 1; i <= max_attempts; i++)); do
    if kubectl get endpoints "$service_name" -n "$namespace" -o jsonpath='{.subsets[*].addresses[*].ip}' 2> /dev/null | grep -q .; then
      log::success "Endpoint '$service_name' is available in namespace '$namespace'"
      return 0
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for endpoint '$service_name' in namespace '$namespace' after ${timeout} seconds"
      return 1
    fi

    log::debug "Attempt $i/$max_attempts - Waiting ${check_interval}s..."
    sleep "$check_interval"
  done

  return 1
}

# Wait for CRD (Custom Resource Definition) to become available
# Args: crd_name, timeout_seconds (default: 300), check_interval_seconds (default: 10)
k8s_wait::crd() {
  local crd_name=$1
  local timeout=${2:-300}
  local check_interval=${3:-10}

  if [[ -z "$crd_name" ]]; then
    log::error "${ERR_MISSING_PARAMS}: crd_name"
    log::info "Usage: k8s_wait::crd <crd-name> [timeout_seconds] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout / check_interval))

  log::info "Waiting for CRD '$crd_name' to be available (timeout: ${timeout}s)..."

  for ((i = 1; i <= max_attempts; i++)); do
    if oc get crd "$crd_name" > /dev/null 2>&1; then
      log::success "CRD '$crd_name' is available"
      return 0
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for CRD '$crd_name' after ${timeout} seconds"
      return 1
    fi

    log::debug "Attempt $i/$max_attempts - Waiting ${check_interval}s..."
    sleep "$check_interval"
  done

  return 1
}

# Wait for Backstage CR to become available
# Args: namespace, backstage_name (default: "backstage"), timeout_seconds (default: 300), check_interval_seconds (default: 10)
k8s_wait::backstage_resource() {
  local namespace=$1
  local backstage_name=${2:-backstage}
  local timeout=${3:-300}
  local check_interval=${4:-10}

  if [[ -z "$namespace" ]]; then
    log::error "${ERR_MISSING_PARAMS}: namespace"
    log::info "Usage: k8s_wait::backstage_resource <namespace> [backstage-name] [timeout_seconds] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout / check_interval))

  log::info "Waiting for Backstage resource '$backstage_name' in namespace '$namespace' (timeout: ${timeout}s)..."

  for ((i = 1; i <= max_attempts; i++)); do
    local status
    status=$(kubectl get backstage "$backstage_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Deployed")].status}' 2> /dev/null || echo "")

    if [[ "$status" == "True" ]]; then
      log::success "Backstage resource '$backstage_name' is deployed in namespace '$namespace'"
      return 0
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for Backstage resource '$backstage_name' in namespace '$namespace' after ${timeout} seconds"
      kubectl describe backstage "$backstage_name" -n "$namespace" 2> /dev/null || true
      return 1
    fi

    log::debug "Attempt $i/$max_attempts - Status: ${status:-NotReady} - Waiting ${check_interval}s..."
    sleep "$check_interval"
  done

  return 1
}
