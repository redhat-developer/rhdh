#!/usr/bin/env bash

# Common utility functions for pipeline scripts
# Dependencies: oc, kubectl, lib/log.sh

# Prevent re-sourcing
if [[ -n "${COMMON_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly COMMON_LIB_SOURCED=1

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

  if ! oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true; then
    log::error "Failed to authenticate to OpenShift cluster at ${K8S_CLUSTER_URL}"
    return 1
  fi

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

# Generic polling helper - waits for a condition to become true
# Args: condition_cmd, max_attempts, wait_interval, description
# Returns: 0 on success, 1 on timeout
common::poll_until() {
  local condition_cmd=$1
  local max_attempts=${2:-60}
  local wait_interval=${3:-5}
  local description=${4:-"condition"}

  for ((i = 1; i <= max_attempts; i++)); do
    if eval "$condition_cmd" &> /dev/null; then
      log::success "$description"
      return 0
    fi
    if ((i == max_attempts)); then
      log::error "Timeout waiting for: $description"
      return 1
    fi
    log::debug "Attempt $i/$max_attempts: Waiting for $description..."
    sleep "$wait_interval"
  done
  return 1
}

# Create configmap from file with idempotent apply
# Args: name, namespace, file_key, file_path
common::create_configmap_from_file() {
  local name=$1
  local namespace=$2
  local file_key=$3
  local file_path=$4

  oc create configmap "$name" \
    --from-file="${file_key}=${file_path}" \
    --namespace="${namespace}" \
    --dry-run=client -o yaml | oc apply -f -
}

# Create configmap from multiple files with idempotent apply
# Args: name, namespace, file_args... (key=path pairs)
common::create_configmap_from_files() {
  local name=$1
  local namespace=$2
  shift 2

  local args=()
  for file_arg in "$@"; do
    args+=("--from-file=${file_arg}")
  done

  oc create configmap "$name" \
    "${args[@]}" \
    --namespace="${namespace}" \
    --dry-run=client -o yaml | oc apply -f -
}

# Base64 encode a string (no newlines, cross-platform)
common::base64_encode() {
  echo -n "$1" | base64 | tr -d '\n'
}

# Retry a command with backoff
# Args: max_attempts, backoff_seconds, command...
# Returns: 0 on success, 1 on failure after all attempts
common::retry() {
  local max_attempts=$1
  local backoff=$2
  shift 2

  local output
  for ((i = 1; i <= max_attempts; i++)); do
    if output=$("$@" 2>&1); then
      log::debug "$output"
      log::success "Command succeeded on attempt $i"
      return 0
    fi
    if ((i < max_attempts)); then
      log::warn "Attempt $i failed, retrying in ${backoff}s..."
      sleep "$backoff"
    fi
  done

  log::error "$output"
  log::error "Command failed after $max_attempts attempts"
  return 1
}

# Save a file to the artifacts directory
# Args: namespace, file_path
common::save_artifact() {
  local namespace=$1
  local file=$2

  if [[ -z "$ARTIFACT_DIR" ]]; then
    log::warn "ARTIFACT_DIR not set, skipping artifact save"
    return 0
  fi

  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "$file" "${ARTIFACT_DIR}/${namespace}/"
}
