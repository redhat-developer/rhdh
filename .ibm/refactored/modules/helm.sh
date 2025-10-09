#!/usr/bin/env bash
#
# Helm Operations Module - All Helm related operations
#

# Guard to prevent multiple sourcing
if [[ -n "${_HELM_LOADED:-}" ]]; then
    return 0
fi
readonly _HELM_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/constants.sh"
source "$(dirname "${BASH_SOURCE[0]}")/sealight.sh"

# ============================================================================
# HELM CHART OPERATIONS
# ============================================================================

# Build common Helm args to DRY flags across commands
build_helm_args() {
    local namespace="$1"
    local expected_hostname="$2"
    shift 2

    local args=(
        "--namespace" "${namespace}"
        "--set-string" "fullnameOverride=${DEPLOYMENT_FULLNAME_OVERRIDE}"
        "--set-string" "global.clusterRouterBase=${K8S_CLUSTER_ROUTER_BASE}"
        "--set-string" "global.host=${expected_hostname}"
        "--set-string" "upstream.backstage.image.repository=${QUAY_REPO}"
        "--set-string" "upstream.backstage.image.tag=${TAG_NAME}"
    )

    # Append extra args passed by the caller
    while (( "$#" )); do
        args+=("$1")
        shift
    done

    printf '%s ' "${args[@]}"
}

uninstall_helmchart() {
    local namespace="$1"
    local release_name="${2:-rhdh}"

    if helm list -n "${namespace}" 2>/dev/null | grep -q "${release_name}"; then
        log_info "Uninstalling Helm chart: ${release_name} from ${namespace}"
        helm uninstall "${release_name}" -n "${namespace}" --wait
        log_success "Helm release ${release_name} uninstalled"
    else
        log_info "Helm release ${release_name} not found in ${namespace}"
    fi
}

get_chart_version() {
    local major_version="${1:-1.7}"

    log_debug "Fetching latest chart version for major version: ${major_version}" >&2

    # Get latest chart version using Quay.io API
    local version
    version=$(curl -sSX GET "https://quay.io/api/v1/repository/rhdh/chart/tag/?onlyActiveTags=true&filter_tag_name=like:${major_version}-" \
        -H "Content-Type: application/json" 2>/dev/null | \
        jq -r '.tags[0].name' 2>/dev/null | \
        grep -oE '[0-9]+\.[0-9]+-[0-9]+-CI' || echo "")
    
    # Fallback if API fails
    if [[ -z "${version}" ]]; then
        log_warning "Could not fetch chart version from API, using default" >&2
        version="1.7-156-CI"
    fi
    
    echo "${version}"
}

validate_chart_version() {
    local chart_version="$1"
    local expected_major="${2:-${CHART_MAJOR_VERSION}}"
    
    log_info "Validating chart version: ${chart_version}"
    
    # Extract major version from chart version (e.g., "1.7" from "1.7-156-CI")
    local actual_major
    actual_major=$(echo "${chart_version}" | grep -oE '^[0-9]+\.[0-9]+' || echo "")
    
    if [[ -z "${actual_major}" ]]; then
        log_error "Invalid chart version format: ${chart_version}"
        return 1
    fi
    
    if [[ "${actual_major}" != "${expected_major}" ]]; then
        log_error "Chart version mismatch!"
        log_error "  Expected major: ${expected_major}"
        log_error "  Actual major:   ${actual_major}"
        log_error "  Full version:   ${chart_version}"
        return 1
    fi
    
    log_success "Chart version validated: ${chart_version} matches expected ${expected_major}"
    return 0
}

verify_helm_chart_exists() {
    local chart_url="$1"
    local chart_version="$2"
    
    log_info "Verifying Helm chart accessibility: ${chart_url} version ${chart_version}"
    
    if helm show chart "${chart_url}" --version "${chart_version}" &>/dev/null; then
        log_success "Helm chart is accessible"
        return 0
    else
        log_error "Cannot access Helm chart: ${chart_url} version ${chart_version}"
        log_error "Please verify:"
        log_error "  1. Chart URL is correct"
        log_error "  2. Chart version exists"
        log_error "  3. Network connectivity to chart repository"
        return 1
    fi
}

get_previous_release_version() {
    local version="${1}"

    # Validate input format
    if ! echo "$version" | grep -qE '^[0-9]+\.[0-9]+$'; then
        echo "Error: Invalid version format. Expected X.Y" >&2
        exit 1
    fi

    local major_version
    major_version=$(echo "$version" | cut -d'.' -f1)
    local minor_version
    minor_version=$(echo "$version" | cut -d'.' -f2)

    # Calculate previous minor version
    local previous_minor=$((minor_version - 1))

    # Check if previous minor version is valid
    if [[ $previous_minor -lt 0 ]]; then
        echo "Error: Cannot calculate previous version for $version" >&2
        exit 1
    fi

    echo "${major_version}.${previous_minor}"
}

get_previous_release_value_file() {
    local value_file_type=${1:-"showcase"}

    # Get the previous release version
    local previous_release_version
    previous_release_version=$(get_previous_release_version "$CHART_MAJOR_VERSION")

    if [[ -z "$previous_release_version" ]]; then
        echo "Failed to determine previous release version." >&2
        exit 1
    fi

    echo "Using previous release version: ${previous_release_version}" >&2

    # Construct the GitHub URL for the value file
    local github_url="https://raw.githubusercontent.com/redhat-developer/rhdh/release-${previous_release_version}/.ibm/pipelines/value_files/values_${value_file_type}.yaml"

    # Create a temporary file path
    local temp_value_file="/tmp/values_${value_file_type}_${previous_release_version}.yaml"

    echo "Fetching value file from: ${github_url}" >&2

    # Download the value file
    if curl -fsSL "${github_url}" -o "${temp_value_file}"; then
        echo "Successfully downloaded value file to: ${temp_value_file}" >&2
        echo "${temp_value_file}"
    else
        echo "Failed to download value file from GitHub." >&2
        exit 1
    fi
}

# ============================================================================
# VALUE FILE SELECTION
# ============================================================================

# Select appropriate value file based on DEPLOY_ORCHESTRATOR flag
# Returns the full path to the value file to use
select_deployment_value_file() {
    local default_file="${1}"   # e.g., "values_showcase.yaml"
    local nightly_file="${2}"   # e.g., "values_showcase_nightly.yaml"
    
    if [[ "${DEPLOY_ORCHESTRATOR:-false}" == "true" ]]; then
        log_info "Orchestrator ENABLED: using ${nightly_file} (with plugins)" >&2
        echo "${DIR}/value_files/${nightly_file}"
    else
        log_info "Orchestrator DISABLED: using ${default_file} (no plugins)" >&2
        echo "${DIR}/value_files/${default_file}"
    fi
}

# ============================================================================
# VALUE FILE MERGE (yq)
# ============================================================================

# Merge Helm value files using yq with two strategies:
#  - merge:     merges everything and deduplicates .global.dynamic.plugins by .package
#  - overwrite: simple override (second file overrides first)
#
# Args:
#   $1 plugin_operation    (merge|overwrite)
#   $2 base_file           (path to base values)
#   $3 diff_file           (path to diff/overlay values)
#   $4 final_file          (output file path)
yq_merge_value_files() {
    local plugin_operation="$1"
    local base_file="$2"
    local diff_file="$3"
    local final_file="$4"

    if ! command -v yq &> /dev/null; then
        log_error "yq is not installed. Please install yq to merge value files."
        return 1
    fi

    if [[ -z "${plugin_operation}" || -z "${base_file}" || -z "${diff_file}" || -z "${final_file}" ]]; then
        log_error "Usage: yq_merge_value_files <merge|overwrite> <base_file> <diff_file> <final_file>"
        return 1
    fi

    # Process diff file with envsubst if it contains environment variables
    local processed_diff_file="${diff_file}"
    if grep -q '\${' "${diff_file}"; then
        processed_diff_file="/tmp/$(basename "${diff_file}").envsubst"
        envsubst < "${diff_file}" > "${processed_diff_file}"
        log_debug "Processed diff file with envsubst"
    fi

    local step_1_file="/tmp/step-without-plugins.yaml"
    local step_2_file="/tmp/step-only-plugins.yaml"

    if [[ "${plugin_operation}" == "merge" ]]; then
        # Step 1: Merge excluding .global.dynamic.plugins
        yq eval-all '
          select(fileIndex == 0) * select(fileIndex == 1) |
          del(.global.dynamic.plugins)
        ' "${base_file}" "${processed_diff_file}" > "${step_1_file}"

        # Step 2: Merge only plugins, deduplicate by .package
        yq eval-all '
          select(fileIndex == 0) *+ select(fileIndex == 1) |
          .global.dynamic.plugins |= (reverse | unique_by(.package) | reverse)
        ' "${base_file}" "${processed_diff_file}" > "${step_2_file}"

        # Step 3: Combine results and remove nulls
        yq eval-all '
          select(fileIndex == 0) * select(fileIndex == 1) | del(.. | select(. == null))
        ' "${step_2_file}" "${step_1_file}" > "${final_file}"
    elif [[ "${plugin_operation}" == "overwrite" ]]; then
        yq eval-all '
          select(fileIndex == 0) * select(fileIndex == 1)
        ' "${base_file}" "${processed_diff_file}" > "${final_file}"
    else
        log_error "Invalid plugin_operation: ${plugin_operation}. Use 'merge' or 'overwrite'."
        return 1
    fi

    # Clean up temporary processed file if created
    if [[ "${processed_diff_file}" != "${diff_file}" ]]; then
        rm -f "${processed_diff_file}"
    fi

    log_success "Merged value file created at ${final_file}"
}

# ============================================================================
# OPTIONAL --set-file SUPPORT
# ============================================================================

# Build optional --set-file arguments from HELM_SET_FILES env var
# Format: HELM_SET_FILES="key1=/abs/path1,key2=/abs/path2"
build_set_file_args() {
    local spec="${HELM_SET_FILES:-}"
    local args=()

    if [[ -z "${spec}" ]]; then
        echo ""
        return 0
    fi

    IFS=',' read -r -a pairs <<< "${spec}"
    for pair in "${pairs[@]}"; do
        # Skip empty entries
        [[ -z "${pair}" ]] && continue
        local key="${pair%%=*}"
        local path="${pair#*=}"
        if [[ -n "${key}" && -n "${path}" ]]; then
            args+=("--set-file" "${key}=${path}")
        fi
    done

    printf '%s ' "${args[@]}"
}

# Execute helm install/upgrade for RHDH with standard parameters
# Centralizes the common helm command pattern used across deployments
helm_preflight_validate() {
    local release_name="${1}"
    local namespace="${2}"
    local value_file="${3}"
    local expected_hostname="${4}"

    log_info "Validating Helm manifests (dry-run) for ${release_name} in ${namespace}"

    local manifest_path="/tmp/${release_name}-${namespace}-manifest.yaml"

    # Optional --set-file args
    local set_file_args
    set_file_args=$(build_set_file_args)

    # Debug: log the exact command
    log_debug "Helm template command: helm template ${release_name} ${HELM_CHART_URL} --version ${CHART_VERSION} --namespace ${namespace} --values ${value_file} --set-string upstream.appConfig.enabled=false"

    # Render manifests locally (with debug for better error messages)
    if ! helm template "${release_name}" "${HELM_CHART_URL}" \
        --version "${CHART_VERSION}" \
        $(build_helm_args "${namespace}" "${expected_hostname}" --values "${value_file}") \
        ${set_file_args} \
        --debug \
        > "${manifest_path}" 2>"${manifest_path}.log"; then
        log_error "Helm template failed. See ${manifest_path}.log"
        return 1
    fi

    # Validate with kubectl
    if ! kubectl apply --dry-run=client -f "${manifest_path}" >/dev/null 2>"${manifest_path}.validate"; then
        log_error "Kubernetes client validation failed for rendered manifests."
        log_error "Inspect: ${manifest_path} and ${manifest_path}.validate"
        # Try to isolate upstream app-config configmap for clearer diagnostics
        local cfg_snippet="/tmp/${release_name}-${namespace}-app-config-configmap.yaml"
        awk '/Source: redhat-developer-hub\\/charts\\/upstream\\/templates\\/app-config-configmap.yaml/{flag=1} flag; /^(---|# Source: )/ && NR>1{flag=0}' "${manifest_path}" > "${cfg_snippet}" || true
        if [[ -s "${cfg_snippet}" ]]; then
            log_info "Validating upstream app-config-configmap snippet: ${cfg_snippet}"
            if ! kubectl apply --dry-run=client -f "${cfg_snippet}" >/dev/null 2>>"${manifest_path}.validate"; then
                log_error "Upstream app-config-configmap validation failed; see ${manifest_path}.validate"
            fi
        fi
        return 1
    fi

    log_success "Helm manifest validation passed"
    return 0
}

helm_install_rhdh() {
    local release_name="${1}"
    local namespace="${2}"
    local value_file="${3}"
    local expected_hostname="${4}"

    log_info "Installing/Upgrading Helm release: ${release_name} in ${namespace}"
    log_debug "Value file: ${value_file}"
    log_debug "Hostname: ${expected_hostname}"

    # Process value file with envsubst to replace environment variables
    local processed_value_file="/tmp/$(basename "${value_file}").processed"
    
    # Debug: log OCM variables before envsubst
    log_debug "OCM_CLUSTER_URL_PLAIN before envsubst: ${OCM_CLUSTER_URL_PLAIN:-NOT_SET}"
    log_debug "OCM_CLUSTER_TOKEN before envsubst: ${OCM_CLUSTER_TOKEN:-NOT_SET}"
    
    # Export all variables for envsubst (it only substitutes exported vars)
    export OCM_CLUSTER_URL_PLAIN OCM_CLUSTER_TOKEN
    
    # Use envsubst without variable list to replace all ${VAR} patterns
    envsubst < "${value_file}" > "${processed_value_file}"
    
    # Debug: check if substitution happened
    if grep -q "OCM_CLUSTER_URL_PLAIN" "${processed_value_file}"; then
        log_warning "envsubst did not replace OCM_CLUSTER_URL_PLAIN in values file"
        log_debug "Processed file location: ${processed_value_file}"
    else
        log_debug "envsubst successfully replaced OCM variables"
    fi

    local helm_timeout=$((TIMEOUT_HELM_INSTALL / 60))  # Convert to minutes

    # Optional --set-file args
    local set_file_args
    set_file_args=$(build_set_file_args)

    # Get Sealight parameters if enabled
    local sealight_params
    sealight_params=$(get_sealight_helm_params)

    helm upgrade --install "${release_name}" "${HELM_CHART_URL}" \
        --version "${CHART_VERSION}" \
        $(build_helm_args "${namespace}" "${expected_hostname}" --values "${processed_value_file}") \
        ${set_file_args} \
        ${sealight_params} \
        --wait --timeout "${helm_timeout}m"

    local result=$?

    # Clean up processed file
    rm -f "${processed_value_file}"

    return $result
}

# Export functions
export -f uninstall_helmchart get_chart_version validate_chart_version verify_helm_chart_exists
export -f get_previous_release_version get_previous_release_value_file
export -f select_deployment_value_file helm_install_rhdh build_helm_args