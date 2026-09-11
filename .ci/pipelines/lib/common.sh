#!/usr/bin/env bash

# Common utility functions for pipeline scripts
# Dependencies: oc, kubectl, lib/log.sh

if [[ -n "${COMMON_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly COMMON_LIB_SOURCED=1

# Source logging library
# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Authenticate to OpenShift cluster using token
# Uses K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL env vars
common::oc_login() {
  common::require_vars K8S_CLUSTER_TOKEN K8S_CLUSTER_URL
  if ! command -v oc &> /dev/null; then
    log::error "oc command not found. Please install OpenShift CLI."
    return 1
  fi

  log::info "Logging into OpenShift cluster..."
  if ! oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" \
    --insecure-skip-tls-verify=true &> /dev/null; then
    log::error "Failed to authenticate to OpenShift cluster"
    return 1
  fi

  if ! oc whoami &> /dev/null; then
    log::error "Authentication verification failed for OpenShift cluster"
    return 1
  fi

  return 0
}

# Authenticate to Kubernetes cluster using service account token
# Uses K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL env vars
common::kubectl_login() {
  common::require_vars K8S_CLUSTER_TOKEN K8S_CLUSTER_URL
  if ! command -v kubectl &> /dev/null; then
    log::error "kubectl command not found. Please install Kubernetes CLI."
    return 1
  fi

  log::info "Logging into Kubernetes cluster..."
  if ! kubectl config set-credentials sa-user --token="${K8S_CLUSTER_TOKEN}" &> /dev/null \
    || ! kubectl config set-cluster k8s-cluster --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true &> /dev/null \
    || ! kubectl config set-context k8s-context --cluster=k8s-cluster --user=sa-user &> /dev/null \
    || ! kubectl config use-context k8s-context &> /dev/null; then
    log::error "Failed to configure kubectl for Kubernetes cluster"
    return 1
  fi

  if ! kubectl auth can-i get nodes &> /dev/null; then
    log::error "Authentication verification failed for Kubernetes cluster"
    return 1
  fi

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

# Print the highest release stream published as a branch under a given major.
# Args:
#   $1 - major_version: e.g. "1"
# Returns:
#   Prints the stream (e.g. "1.10"), or nothing if no such branch exists
#   Non-zero if the remote could not be read at all
common::highest_release_stream_for_major() {
  local major=$1
  if [[ ! "$major" =~ ^[0-9]+$ ]]; then
    log::error "Major version must be numeric (got: '${major}')"
    return 1
  fi

  # Capture before filtering: piping straight into sed would discard git's
  # status, making an unreachable remote look like "no such branch".
  local refs
  if ! refs=$(git ls-remote --heads "https://github.com/${REPO_OWNER:-redhat-developer}/${REPO_NAME:-rhdh}" \
    "refs/heads/release-${major}.*" 2> /dev/null); then
    log::error "Failed to list release branches from the remote"
    return 1
  fi

  printf '%s' "$refs" \
    | sed 's|.*refs/heads/release-||' \
    | grep -E "^${major}\.[0-9]+$" \
    | sort -uV \
    | tail -1
}

# Calculate previous release version from current version
# Usage: prev=$(common::get_previous_release_version "1.6") # Returns: "1.5"
#        prev=$(common::get_previous_release_version "2.0") # Returns: "1.10"
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

  if [[ $minor_version -gt 0 ]]; then
    echo "${major_version}.$((minor_version - 1))"
    return 0
  fi

  # Major rollover. The number of minors in the preceding major is not fixed, so
  # look it up rather than computing it. Ask the release branches, not the chart
  # tags: streams are published from main before their branch is cut, so when
  # main became 2.0 the newest 1.x chart tag was 1.11 while the newest
  # release-1.x branch was 1.10. Callers fetch value files from
  # release-<version> on GitHub, so a version without a branch is unusable.
  local previous_major=$((major_version - 1))
  if [[ $previous_major -lt 1 ]]; then
    log::error "Cannot calculate previous version for $version"
    return 1
  fi

  local previous_version
  previous_version=$(common::highest_release_stream_for_major "$previous_major")

  if [[ -z "$previous_version" ]]; then
    log::error "Cannot calculate previous version for ${version}: no release-${previous_major}.x branch found"
    return 1
  fi

  echo "$previous_version"
}

# Default downstream hub image repository for the current release branch.
# Maintenance branches (release-1.x) use RHEL 9 images; main / 2.y streams use RHEL 10.
# Remove this if/else and only use RHEL10 once we have EOL'd RHDH 1.10 (after 2.2 is live, or after all the SUPPORTEX tickets expire)
common::default_hub_image_repo() {
  local branch="${RELEASE_BRANCH_NAME:-main}"
  if [[ "$branch" == release-1.* ]]; then
    echo "rhdh/rhdh-hub-rhel9"
  else
    echo "rhdh/rhdh-hub-rhel10"
  fi
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

# Validate that required variables are set and non-empty
# Args: variable_names...
# Returns: 1 if any variable is unset or empty
common::require_vars() {
  for var in "$@"; do
    if [[ -z "${!var:-}" ]]; then
      log::error "Required variable $var is not set"
      return 1
    fi
  done
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

# Save a file or directory to the artifacts directory
# Args:
#   $1 - artifacts_subdir: Subdirectory under ARTIFACT_DIR (typically playwright_project)
#   $2 - file_path: File or directory to save
#   $3 - subdir: (optional) Additional subdirectory under artifacts_subdir
common::save_artifact() {
  local artifacts_subdir=$1
  local file=$2
  local subdir=${3:-}

  if [[ -z "$ARTIFACT_DIR" ]]; then
    log::warn "ARTIFACT_DIR not set, skipping artifact save"
    return 0
  fi

  local target_dir="${ARTIFACT_DIR}/${artifacts_subdir}"
  if [[ -n "$subdir" ]]; then
    target_dir="${target_dir}/${subdir}"
  fi

  mkdir -p "${target_dir}"
  rsync -a "$file" "${target_dir}/"
}

# Normalize Helm chart image fields when a digest is encoded as
# repository "repo@sha256" plus tag "<hash>". Updates the named variables in place.
# Args:
#   $1 - repository variable name
#   $2 - separator variable name (set to ":" or "@sha256:")
# shellcheck disable=SC2034 # namerefs write through to the caller
common::normalize_chart_image_ref() {
  local -n out_repo=$1
  local -n out_separator=$2

  out_separator=":"
  if [[ "${out_repo}" == *"@"* ]]; then
    out_separator="@${out_repo##*@}:"
    out_repo="${out_repo%@*}"
  fi
}

# Export functions for subshell usage (e.g., timeout bash -c "...")
export -f common::base64_encode
export -f common::require_vars
export -f common::normalize_chart_image_ref
