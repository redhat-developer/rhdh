#!/usr/bin/env bash

# Common utility functions for pipeline scripts
# Dependencies: oc, kubectl

set -euo pipefail

# Authenticate to OpenShift cluster using token
# Uses K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL env vars
common::oc_login() {
  oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true
  echo "OCP version: $(oc version)"
}

# Check if current cluster is OpenShift
common::is_openshift() {
  oc get routes.route.openshift.io &> /dev/null || kubectl get routes.route.openshift.io &> /dev/null
}

# Cross-platform sed in-place editing (macOS/Linux)
common::sed_inplace() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# Calculate previous release version from current version
# Usage: prev=$(common::get_previous_release_version "1.6") # Returns: "1.5"
common::get_previous_release_version() {
  local version=$1

  if [[ -z "$version" ]]; then
    log::error "Version parameter is required"
    return 1
  fi

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+$ ]]; then
    log::error "Version must be in format X.Y (e.g., 1.6)"
    return 1
  fi

  local major_version
  major_version=$(echo "$version" | cut -d'.' -f1)
  local minor_version
  minor_version=$(echo "$version" | cut -d'.' -f2)

  local previous_minor=$((minor_version - 1))

  if [[ $previous_minor -lt 0 ]]; then
    log::error "Cannot calculate previous version for $version"
    return 1
  fi

  echo "${major_version}.${previous_minor}"
}
