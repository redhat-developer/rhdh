#!/usr/bin/env bash

# Common utility functions for pipeline scripts
# Dependencies: oc, kubectl, lib/log.sh

# Source logging library
# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Authenticate to OpenShift cluster using token
# Uses K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL env vars
common::oc_login() {
  if ! command -v oc &> /dev/null; then
    log::error "oc command not found. Please install OpenShift CLI."
    return 1
  fi

  oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true
  # Safely log version without exposing sensitive server details
  oc version --client 2>&1 | head -1 || log::warn "Could not retrieve oc client version"
  return 0
}

# Cross-platform sed in-place editing (macOS/Linux)
common::sed_inplace() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
  return $?
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
