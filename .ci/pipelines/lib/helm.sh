#!/usr/bin/env bash

# Helm chart operations and value file manipulation utilities
# Dependencies: helm, yq, curl, jq, lib/log.sh, lib/common.sh

if [[ -n "${HELM_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly HELM_LIB_SOURCED=1

readonly HELM_CHART_TAGS_API="https://quay.io/api/v1/repository/rhdh/chart/tag/"

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
  current_release_version=$(helm::get_chart_stream)
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

# Fetch a page of chart tags from Quay. Captures the body first: piping curl
# into jq loses curl's status, so a 5xx would read as "no tags published".
# Args:
#   $1 - query: extra query string, e.g. "filter_tag_name=like:1.10-"
helm::_fetch_chart_tags() {
  local query=$1
  local body
  if ! body=$(curl -sSfX GET "${HELM_CHART_TAGS_API}?onlyActiveTags=true&${query}"); then
    log::error "Failed to query chart tags from Quay (${query})"
    return 1
  fi
  printf '%s' "$body"
}

# Print the newest CI chart tag for a major.minor stream, or nothing if none exist.
# Args:
#   $1 - chart_stream: e.g. "1.10"
helm::_latest_chart_tag() {
  local chart_stream=$1
  if [[ ! "$chart_stream" =~ ^[0-9]+\.[0-9]+$ ]]; then
    log::error "Chart stream must be in format X.Y (got: '${chart_stream}')"
    return 1
  fi

  helm::_fetch_chart_tags "filter_tag_name=like:${chart_stream}-" \
    | jq -r '[.tags[] | select(.name | test("^[0-9]+\\.[0-9]+-[0-9]+-CI$"))] | max_by(.start_ts) | .name // empty'
}

# Print the highest stream with any chart published. Reads the first page only,
# which Quay returns newest-first.
helm::_highest_published_chart_stream() {
  helm::_fetch_chart_tags "limit=100" \
    | jq -r '.tags[].name' \
    | grep -oE '^[0-9]+\.[0-9]+' \
    | sort -uV | tail -1
}

# Resolve the chart version: an explicit CHART_VERSION wins, then a pinned
# TAG_NAME (image and chart ship together), then the newest chart on this
# checkout's stream.
# Uses globals: CHART_VERSION, TAG_NAME
helm::resolve_chart_version() {
  if [[ -n "${CHART_VERSION:-}" ]]; then
    log::info "Using preset CHART_VERSION (pinned or from env): ${CHART_VERSION}" >&2
    echo "${CHART_VERSION}"
    return 0
  fi

  # RC images are tagged x.y-N with chart x.y-N-CI; GA images x.y.z with chart
  # x.y.z. Both shapes appear in the verification flows, so both have to map.
  if [[ "${TAG_NAME:-}" =~ ^[0-9]+\.[0-9]+-[0-9]+$ ]]; then
    log::info "Derived CHART_VERSION from pinned TAG_NAME: ${TAG_NAME}-CI" >&2
    echo "${TAG_NAME}-CI"
    return 0
  fi

  if [[ "${TAG_NAME:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log::info "Derived CHART_VERSION from pinned GA TAG_NAME: ${TAG_NAME}" >&2
    echo "${TAG_NAME}"
    return 0
  fi

  helm::get_chart_version
}

# Get the release stream this run belongs to: a major.minor pair like "1.10",
# not a bare major. 'main' takes it from package.json; 'release-x.y' from the
# branch name.
# Args:
#   $1 - (optional) version_override: Specific stream to use (e.g., "1.8" for upgrade base)
# Returns:
#   Prints the stream (e.g., "1.10")
helm::get_chart_stream() {
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
    # main carries no version in its name. The published tags cannot answer
    # this either - they hold every stream anyone pushed, so "highest on quay"
    # follows whichever stream is ahead, not this checkout's.
    local package_json="${DIR}/../../package.json"
    if [[ ! -f "$package_json" ]]; then
      log::error "Cannot determine the chart stream: ${package_json} not found"
      return 1
    fi

    local chart_stream
    chart_stream=$(jq -r '.version // empty' "$package_json" | grep -oE '^[0-9]+\.[0-9]+')
    if [[ -z "$chart_stream" ]]; then
      log::error "Cannot determine the chart stream: no usable .version in ${package_json}"
      return 1
    fi
    echo "$chart_stream"
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
  local chart_stream
  chart_stream=$(helm::get_chart_stream "${1:-}")
  if [[ -z "$chart_stream" ]]; then
    return 1
  fi

  # The helpers end in a pipe, so their status is jq's and a failed curl still
  # returns 0. Empty output is the only reliable signal.
  local version
  version=$(helm::_latest_chart_tag "${chart_stream}")

  # Right after a version bump, package.json can name a stream with no chart
  # built yet. Fall back so the run survives that one-build gap - but only on
  # main, where the gap exists. A release branch or an explicit override named
  # the stream it wants, and quietly serving another would hide the mistake.
  if [[ -z "$version" && -z "${1:-}" && "${RELEASE_BRANCH_NAME:-}" == "main" ]]; then
    local fallback_stream
    fallback_stream=$(helm::_highest_published_chart_stream)
    if [[ -n "$fallback_stream" && "$fallback_stream" != "$chart_stream" ]]; then
      log::warn "No chart published for ${chart_stream} yet; falling back to ${fallback_stream}"
      version=$(helm::_latest_chart_tag "${fallback_stream}")
    fi
  fi

  if [[ -z "$version" ]]; then
    log::error "Failed to resolve chart version for ${chart_stream}"
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
