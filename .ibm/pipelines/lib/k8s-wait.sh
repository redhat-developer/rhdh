#!/usr/bin/env bash

# Kubernetes/OpenShift resource waiting and polling utilities
# Dependencies: oc, kubectl, lib/log.sh

set -euo pipefail

# Wait for deployment to become ready
# Args: namespace, resource_name, timeout_minutes (default: 5), check_interval_seconds (default: 10)
k8s_wait::deployment() {
  local namespace=$1
  local resource_name=$2
  local timeout_minutes=${3:-5}
  local check_interval=${4:-10}

  if [[ -z "$namespace" || -z "$resource_name" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: k8s_wait::deployment <namespace> <resource-name> [timeout_minutes] [check_interval_seconds]"
    return 1
  fi

  local max_attempts=$((timeout_minutes * 60 / check_interval))

  log::info "Waiting for resource '$resource_name' in namespace '$namespace' (timeout: ${timeout_minutes}m)..."

  for ((i = 1; i <= max_attempts; i++)); do
    local pod_name
    pod_name=$(oc get pods -n "$namespace" | grep "$resource_name" | awk '{print $1}' | head -n 1)

    if [[ -n "$pod_name" ]]; then
      local pod_ready_status
      pod_ready_status=$(oc get pod "$pod_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')

      if [[ "$pod_ready_status" == "True" ]]; then
        log::success "Resource '$resource_name' is ready in namespace '$namespace'"
        return 0
      fi

      local container_statuses
      container_statuses=$(oc get pod "$pod_name" -n "$namespace" -o jsonpath='{.status.containerStatuses}')
      log::debug "Pod '$pod_name' status: Ready=$pod_ready_status, Containers=$container_statuses"
    else
      log::debug "No pods found matching '$resource_name' in namespace '$namespace'"
    fi

    if ((i == max_attempts)); then
      log::error "Timeout waiting for resource '$resource_name' in namespace '$namespace' after ${timeout_minutes} minutes"
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
    log::error "Missing required parameters"
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
    log::error "Missing required parameters"
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
    log::error "Missing required parameters"
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

# Wait for Backstage CR to become available
# Args: backstage_name, namespace, timeout_seconds (default: 300), check_interval_seconds (default: 10)
k8s_wait::backstage_resource() {
  local backstage_name=$1
  local namespace=$2
  local timeout=${3:-300}
  local check_interval=${4:-10}

  if [[ -z "$backstage_name" || -z "$namespace" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: k8s_wait::backstage_resource <backstage-name> <namespace> [timeout_seconds] [check_interval_seconds]"
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
