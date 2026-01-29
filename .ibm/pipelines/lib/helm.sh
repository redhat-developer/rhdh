#!/usr/bin/env bash

# Helm chart operations and value file manipulation utilities
# Dependencies: helm, yq, curl, jq, lib/log.sh, lib/common.sh

# Prevent re-sourcing
if [[ -n "${HELM_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly HELM_LIB_SOURCED=1

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ibm/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"

# ==============================================================================
# Value File Operations
# ==============================================================================

# Merge the base YAML value file with the differences file for Kubernetes
# Args:
#   $1 - plugin_operation: "merge" to combine plugins, "overwrite" to replace
#   $2 - base_file: Path to the base values file
#   $3 - diff_file: Path to the differences file
#   $4 - final_file: Output path for the merged file
# Returns:
#   0 - Success
#   1 - Invalid operation specified
helm::merge_values() {
  local plugin_operation=$1
  local base_file=$2
  local diff_file=$3
  local final_file=$4
  local step_1_file="/tmp/step-without-plugins.yaml"
  local step_2_file="/tmp/step-only-plugins.yaml"

  if [[ -z "$plugin_operation" || -z "$base_file" || -z "$diff_file" || -z "$final_file" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: helm::merge_values <operation> <base_file> <diff_file> <output_file>"
    return 1
  fi

  if [[ "$plugin_operation" == "merge" ]]; then
    # Step 1: Merge files, excluding the .global.dynamic.plugins key
    # Values from `diff_file` override those in `base_file`
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1) |
      del(.global.dynamic.plugins)
    ' "${base_file}" "${diff_file}" > "${step_1_file}"

    # Step 2: Merge files, combining the .global.dynamic.plugins key
    # Values from `diff_file` take precedence; plugins are merged and deduplicated by the .package field
    yq eval-all '
      select(fileIndex == 0) *+ select(fileIndex == 1) |
      .global.dynamic.plugins |= (reverse | unique_by(.package) | reverse)
    ' "${base_file}" "${diff_file}" > "${step_2_file}"

    # Step 3: Combine results from the previous steps and remove null values
    # Values from `step_2_file` override those in `step_1_file`
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1) | del(.. | select(. == null))
    ' "${step_2_file}" "${step_1_file}" > "${final_file}"

  elif [[ "$plugin_operation" == "overwrite" ]]; then
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1)
    ' "${base_file}" "${diff_file}" > "${final_file}"
  else
    log::error "Invalid operation with plugins key: $plugin_operation (expected 'merge' or 'overwrite')"
    return 1
  fi
}

# Get the previous release value file from GitHub
# Args:
#   $1 - value_file_type: Type of value file (default: "showcase", can be "showcase-rbac")
# Returns:
#   Prints the path to the downloaded value file
helm::get_previous_release_values() {
  local value_file_type=${1:-"showcase"}

  # Get the previous release version
  local previous_release_version
  previous_release_version=$(common::get_previous_release_version "$CHART_MAJOR_VERSION")

  if [[ -z "$previous_release_version" ]]; then
    log::error "Failed to determine previous release version."
    return 1
  fi

  log::info "Using previous release version: ${previous_release_version}" >&2

  # Construct the GitHub URL for the value file
  local github_url="https://raw.githubusercontent.com/redhat-developer/rhdh/release-${previous_release_version}/.ibm/pipelines/value_files/values_${value_file_type}.yaml"

  # Create a temporary file path for the downloaded value file
  local temp_value_file="/tmp/values_${value_file_type}_${previous_release_version}.yaml"

  log::info "Fetching value file from: ${github_url}" >&2

  # Download the value file from GitHub
  if curl -fsSL "${github_url}" -o "${temp_value_file}"; then
    log::success "Successfully downloaded value file to: ${temp_value_file}" >&2
    echo "${temp_value_file}"
  else
    log::error "Failed to download value file from GitHub."
    return 1
  fi
}

# ==============================================================================
# Chart Operations
# ==============================================================================

# Get the latest chart version for a given major version
# Args:
#   $1 - chart_major_version: The major version to search for (e.g., "1.4")
# Returns:
#   Prints the chart version (e.g., "1.4-123-CI")
helm::get_chart_version() {
  local chart_major_version=$1

  if [[ -z "$chart_major_version" ]]; then
    log::error "Missing chart major version parameter"
    log::info "Usage: helm::get_chart_version <major_version>"
    return 1
  fi

  curl -sSX GET "https://quay.io/api/v1/repository/rhdh/chart/tag/?onlyActiveTags=true&filter_tag_name=like:${chart_major_version}-" \
    -H "Content-Type: application/json" \
    | jq -r '.tags[0].name' | grep -oE '[0-9]+\.[0-9]+-[0-9]+-CI'
}

# Uninstall a Helm chart if it exists
# Args:
#   $1 - namespace: The namespace where the chart is installed
#   $2 - release_name: The name of the Helm release
# Returns:
#   0 - Success (chart removed or didn't exist)
helm::uninstall() {
  local namespace=$1
  local release_name=$2

  if [[ -z "$namespace" || -z "$release_name" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: helm::uninstall <namespace> <release_name>"
    return 1
  fi

  if helm list -n "${namespace}" | grep -q "${release_name}"; then
    log::warn "Chart '${release_name}' exists. Removing it before install."
    helm uninstall "${release_name}" -n "${namespace}"
  fi
}

# ==============================================================================
# Install Operations
# ==============================================================================

# Get common Helm set parameters for image configuration
# Uses global variables: QUAY_REPO, TAG_NAME
# Returns:
#   Prints the Helm --set parameters string
helm::get_image_params() {
  local params=""

  # Add image repository
  params+="--set upstream.backstage.image.repository=${QUAY_REPO} "

  # Add image tag
  params+="--set upstream.backstage.image.tag=${TAG_NAME} "

  echo "${params}"
  return 0
}

# Perform Helm install/upgrade with standard parameters
# Args:
#   $1 - release_name: The name for the Helm release
#   $2 - namespace: The namespace to install into
#   $3 - value_file: The value file name (relative to value_files directory)
# Uses global variables: HELM_CHART_URL, CHART_VERSION, DIR, K8S_CLUSTER_ROUTER_BASE
# Returns:
#   0 - Success
#   Non-zero - Helm command failed
helm::install() {
  local release_name=$1
  local namespace=$2
  local value_file=$3

  if [[ -z "$release_name" || -z "$namespace" || -z "$value_file" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: helm::install <release_name> <namespace> <value_file>"
    return 1
  fi

  log::info "Installing Helm chart '${release_name}' in namespace '${namespace}'"

  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${DIR}/value_files/${value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params)
}

# ==============================================================================
# Backward Compatibility Aliases
# These functions delegate to the new namespaced functions for backward compatibility
# ==============================================================================

# Alias for backward compatibility
yq_merge_value_files() { helm::merge_values "$@"; return $?; }
uninstall_helmchart() { helm::uninstall "$@"; return $?; }
get_image_helm_set_params() { helm::get_image_params "$@"; return $?; }
perform_helm_install() { helm::install "$@"; return $?; }
get_chart_version() { helm::get_chart_version "$@"; return $?; }
get_previous_release_value_file() { helm::get_previous_release_values "$@"; return $?; }
