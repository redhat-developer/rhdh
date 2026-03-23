#!/bin/bash

patch_and_restart() {
  local namespace=$1
  local resource_type=$2
  local resource_name=$3
  local patch_file=$4

  echo "Waiting for $resource_type/$resource_name to be present..."
  kubectl wait --for=jsonpath='{.metadata.name}'="$resource_name" "$resource_type/$resource_name" -n "$namespace" --timeout=60s

  echo "Patching $resource_type/$resource_name in namespace $namespace with file $patch_file"
  kubectl patch "$resource_type" "$resource_name" -n "$namespace" --type=merge --patch-file "$patch_file"

  echo "Scaling down $resource_type/$resource_name to 0 replicas"
  kubectl scale "$resource_type" "$resource_name" --replicas=0 -n "$namespace"

  echo "Waiting for pods to terminate gracefully (timeout: 60s)..."
  if ! kubectl wait --for=delete pods -l app="$resource_name" -n "$namespace" --timeout=60s; then
    echo "Warning: Pods did not terminate gracefully within 60s"
    echo "Attempting force deletion of pods..."
    kubectl delete pods -l app="$resource_name" -n "$namespace" --force --grace-period=0
    # Wait a bit to ensure pods are actually gone
    sleep 5
  fi

  echo "Scaling up $resource_type/$resource_name to 1 replica"
  kubectl scale "$resource_type" "$resource_name" --replicas=1 -n "$namespace"

  echo "Patch and restart completed for $resource_type/$resource_name"
}
