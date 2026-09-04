#!/usr/bin/env bash

# Helm chart operations and value file manipulation utilities
# Dependencies: helm, yq, curl, jq, lib/log.sh, lib/common.sh

if [[ -n "${HELM_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly HELM_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ci/pipelines/lib/common.sh
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

  if [[ -z "$plugin_operation" || -z "$base_file" || -z "$diff_file" || -z "$final_file" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: helm::merge_values <operation> <base_file> <diff_file> <output_file>"
    return 1
  fi

  if [[ "$plugin_operation" == "merge" ]]; then
    local step_1_file step_2_file
    step_1_file=$(mktemp "${TMPDIR:-/tmp}/helm-merge-step1-XXXXXX.yaml")
    step_2_file=$(mktemp "${TMPDIR:-/tmp}/helm-merge-step2-XXXXXX.yaml")

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

    rm -f "${step_1_file}" "${step_2_file}"

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

  local current_release_version
  current_release_version=$(helm::get_chart_major_version)
  if [[ -z "$current_release_version" ]]; then
    return 1
  fi

  # Get the previous release version
  local previous_release_version
  previous_release_version=$(common::get_previous_release_version "$current_release_version")

  if [[ -z "$previous_release_version" ]]; then
    log::error "Failed to determine previous release version."
    return 1
  fi

  log::info "Using previous release version: ${previous_release_version}" >&2

  # Construct the GitHub URL for the value file
  local github_url="https://raw.githubusercontent.com/redhat-developer/rhdh/release-${previous_release_version}/.ci/pipelines/value_files/values_${value_file_type}.yaml"

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

# Print the newest CI chart tag for a major.minor stream, or nothing if none exist.
# Args:
#   $1 - chart_major_version: e.g. "1.10"
helm::_latest_chart_tag() {
  curl -sSfX GET "https://quay.io/api/v1/repository/rhdh/chart/tag/?onlyActiveTags=true&filter_tag_name=like:${1}-" \
    -H "Content-Type: application/json" \
    | jq -r '[.tags[] | select(.name | test("^[0-9]+\\.[0-9]+-[0-9]+-CI$"))] | max_by(.start_ts) | .name // empty'
}

# Print the highest major.minor stream that has any chart published.
helm::_highest_published_chart_major() {
  curl -sSX GET "https://quay.io/api/v1/repository/rhdh/chart/tag/?onlyActiveTags=true&limit=100" \
    -H "Content-Type: application/json" \
    | jq -r '.tags[].name' \
    | grep -oE '^[0-9]+\.[0-9]+' \
    | sort -uV | tail -1
}

# Get the chart major.minor version based on RELEASE_BRANCH_NAME or an optional override.
# Uses RELEASE_BRANCH_NAME: 'main' -> highest major.minor from Quay; 'release-x.y' -> extract x.y.
# Args:
#   $1 - (optional) version_override: Specific version to use (e.g., "1.8" for upgrade base)
# Returns:
#   Prints the major.minor version (e.g., "1.9")
helm::get_chart_major_version() {
  local version_override=${1:-}

  if [[ -n "$version_override" ]]; then
    echo "$version_override"
    return 0
  fi

  if [[ -z "${RELEASE_BRANCH_NAME:-}" ]]; then
    log::error "RELEASE_BRANCH_NAME is not set"
    return 1
  fi

  if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
    # main carries no version in its name, so read the one the branch declares.
    # The published tags cannot answer this: they hold every stream anyone has
    # pushed, so "the highest version on quay" silently follows whichever stream
    # happens to be ahead rather than the one this checkout belongs to.
    local chart_major_version
    chart_major_version=$(jq -r '.version // empty' "${DIR}/../../package.json" 2> /dev/null \
      | grep -oE '^[0-9]+\.[0-9]+')
    if [[ -z "$chart_major_version" ]]; then
      log::error "Failed to read the version from package.json"
      return 1
    fi
    echo "$chart_major_version"
  elif echo "$RELEASE_BRANCH_NAME" | grep -qE '^release-[0-9]+\.[0-9]+$'; then
    echo "$RELEASE_BRANCH_NAME" | grep -oE '[0-9]+\.[0-9]+'
  else
    log::error "Invalid RELEASE_BRANCH_NAME: $RELEASE_BRANCH_NAME (expected 'main' or 'release-x.y')"
    return 1
  fi
}

# Get the latest chart version based on RELEASE_BRANCH_NAME or an optional version override.
# Args:
#   $1 - (optional) version_override: Specific version to use (e.g., "1.8" for upgrade base)
# Returns:
#   Prints the chart version (e.g., "1.4-123-CI")
helm::get_chart_version() {
  local chart_major_version
  chart_major_version=$(helm::get_chart_major_version "${1:-}")
  if [[ -z "$chart_major_version" ]]; then
    return 1
  fi

  local version
  version=$(helm::_latest_chart_tag "${chart_major_version}") || {
    log::error "Failed to resolve chart version for ${chart_major_version}"
    return 1
  }

  # Between a version bump and the first chart built from it, no tag exists for
  # the version package.json declares. Fall back to the newest published stream
  # so the run continues rather than failing on a gap that closes by itself.
  if [[ -z "$version" || "$version" == "null" ]]; then
    local fallback_major
    fallback_major=$(helm::_highest_published_chart_major)
    if [[ -n "$fallback_major" && "$fallback_major" != "$chart_major_version" ]]; then
      log::warn "No chart published for ${chart_major_version} yet; falling back to ${fallback_major}"
      version=$(helm::_latest_chart_tag "${fallback_major}")
    fi
  fi

  if [[ -z "$version" || "$version" == "null" ]]; then
    log::error "Failed to resolve chart version for ${chart_major_version}"
    return 1
  fi
  echo "$version"
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

# Get common Helm set parameters for image configuration.
#
# Uses global variables: IMAGE_REGISTRY, IMAGE_REPO, TAG_NAME,
#   CATALOG_INDEX_REGISTRY, CATALOG_INDEX_REPO, CATALOG_INDEX_TAG (from env_variables.sh)
#
# Options (all optional; defaults reproduce the connected-install behavior):
#   --backstage-registry <r>  Override upstream.backstage.image.registry
#                             (default: IMAGE_REGISTRY). Disconnected installs
#                             pass the in-cluster mirror host.
#   --catalog-registry <r>    Override global.catalogIndex.image.registry
#                             (default: CATALOG_INDEX_REGISTRY). Disconnected
#                             installs pass MIRROR_REGISTRY_URL.
#   --omit-backstage-image    Skip the upstream.backstage.image.* flags entirely
#                             (LOCAL_DISCONNECTED lets the chart + IDMS resolve
#                             the hub image instead of pinning it).
# Returns:
#   Prints the Helm --set parameters string
# shellcheck disable=SC2120 # all args optional; callers in other files pass them
helm::get_image_params() {
  local backstage_registry="${IMAGE_REGISTRY}"
  local catalog_registry="${CATALOG_INDEX_REGISTRY:-}"
  local omit_backstage_image="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --backstage-registry)
        backstage_registry="$2"
        shift 2
        ;;
      --catalog-registry)
        catalog_registry="$2"
        shift 2
        ;;
      --omit-backstage-image)
        omit_backstage_image="true"
        shift
        ;;
      *)
        log::error "helm::get_image_params: unknown option '$1'"
        return 1
        ;;
    esac
  done

  local params=""

  if [[ "${omit_backstage_image}" != "true" ]]; then
    params+="--set upstream.backstage.image.registry=${backstage_registry} "
    params+="--set upstream.backstage.image.repository=${IMAGE_REPO} "
    params+="--set upstream.backstage.image.tag=${TAG_NAME} "
  fi

  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    params+="--set global.catalogIndex.image.registry=${catalog_registry} "
    params+="--set global.catalogIndex.image.repository=${CATALOG_INDEX_REPO} "
    params+="--set global.catalogIndex.image.tag=${CATALOG_INDEX_TAG} "
  fi

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
