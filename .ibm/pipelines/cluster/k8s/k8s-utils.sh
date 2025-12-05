#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh

patch_and_restart() {
  local namespace=$1
  local resource_type=$2
  local resource_name=$3
  local patch_file=$4

  log::debug "Waiting for $resource_type/$resource_name to be present..."
  kubectl wait --for=jsonpath='{.metadata.name}'="$resource_name" "$resource_type/$resource_name" -n "$namespace" --timeout=60s

  log::info "Patching $resource_type/$resource_name in namespace $namespace with file $patch_file"
  kubectl patch "$resource_type" "$resource_name" -n "$namespace" --type=merge --patch-file "$patch_file"

  log::debug "Scaling down $resource_type/$resource_name to 0 replicas"
  kubectl scale "$resource_type" "$resource_name" --replicas=0 -n "$namespace"

  log::debug "Waiting for pods to terminate gracefully (timeout: 60s)..."
  if ! kubectl wait --for=delete pods -l app="$resource_name" -n "$namespace" --timeout=60s; then
    log::warn "Pods did not terminate gracefully within 60s"
    log::warn "Attempting force deletion of pods..."
    kubectl delete pods -l app="$resource_name" -n "$namespace" --force --grace-period=0
    # Wait a bit to ensure pods are actually gone
    sleep 5
  fi

  log::debug "Scaling up $resource_type/$resource_name to 1 replica"
  kubectl scale "$resource_type" "$resource_name" --replicas=1 -n "$namespace"

  log::success "Patch and restart completed for $resource_type/$resource_name"
}
