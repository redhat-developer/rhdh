#!/usr/bin/env bash

# Configuration management utilities for CI pipelines
# Handles ConfigMap creation, dynamic plugins, and app configuration
# Dependencies: oc, yq, lib/log.sh, lib/common.sh

# Prevent re-sourcing
if [[ -n "${CONFIG_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly CONFIG_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ci/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"

# ==============================================================================
# ConfigMap Operations
# ==============================================================================

# Create app-config-rhdh ConfigMap from a configuration file
# Args:
#   $1 - config_file: Path to the app configuration file
#   $2 - namespace: Target namespace for the ConfigMap
# Returns:
#   0 - Success
config::create_app_config_map() {
  local config_file=$1
  local namespace=$2

  if [[ -z "$config_file" || -z "$namespace" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: config::create_app_config_map <config_file> <namespace>"
    return 1
  fi

  oc create configmap app-config-rhdh \
    --from-file="app-config-rhdh.yaml"="$config_file" \
    --namespace="$namespace" \
    --dry-run=client -o yaml | oc apply -f -
  return $?
}

# Select the appropriate config map file based on project type
# Args:
#   $1 - project: The project/namespace name
#   $2 - dir: Base directory for config files
# Returns:
#   Prints the path to the appropriate config file
config::select_config_map_file() {
  local project=$1
  local dir=$2

  if [[ -z "$project" || -z "$dir" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: config::select_config_map_file <project> <dir>"
    return 1
  fi

  if [[ "${project}" == *rbac* ]]; then
    echo "$dir/resources/config_map/app-config-rhdh-rbac.yaml"
  else
    echo "$dir/resources/config_map/app-config-rhdh.yaml"
  fi
  return 0
}

# ==============================================================================
# Dynamic Plugins Configuration
# ==============================================================================

# Create dynamic plugins ConfigMap from a values file
# Args:
#   $1 - base_file: Path to the values file containing plugin configuration
#   $2 - output_file: Path for the generated ConfigMap YAML
# Returns:
#   0 - Success
config::create_dynamic_plugins_config() {
  local base_file=$1
  local output_file=$2

  if [[ -z "$base_file" || -z "$output_file" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: config::create_dynamic_plugins_config <base_file> <output_file>"
    return 1
  fi

  cat > "${output_file}" << 'EOF'
kind: ConfigMap
apiVersion: v1
metadata:
  name: dynamic-plugins
data:
  dynamic-plugins.yaml: |
EOF
  yq '.global.dynamic' "${base_file}" | sed -e 's/^/    /' >> "${output_file}"
  return $?
}

# ==============================================================================
# Operator Configuration
# ==============================================================================

# Create conditional policies file for RBAC operator deployment
# Args:
#   $1 - destination_file: Path for the generated policies file
# Returns:
#   0 - Success
config::create_conditional_policies_operator() {
  local destination_file=$1

  if [[ -z "$destination_file" ]]; then
    log::error "Missing required parameter: destination_file"
    log::info "Usage: config::create_conditional_policies_operator <destination_file>"
    return 1
  fi

  yq '.upstream.backstage.initContainers[0].command[2]' "${DIR}/value_files/values_showcase-rbac.yaml" \
    | head -n -4 \
    | tail -n +2 > "$destination_file"
  common::sed_inplace 's/\\\$/\$/g' "$destination_file"
  return $?
}

# Prepare app configuration for operator deployment with RBAC
# Args:
#   $1 - config_file: Path to the app configuration file to modify
# Returns:
#   0 - Success
config::prepare_operator_app_config() {
  local config_file=$1

  if [[ -z "$config_file" ]]; then
    log::error "Missing required parameter: config_file"
    log::info "Usage: config::prepare_operator_app_config <config_file>"
    return 1
  fi

  yq e -i '.permission.rbac.conditionalPoliciesFile = "./rbac/conditional-policies.yaml"' "${config_file}"
  return $?
}

# Merge two dynamic plugin config YAML files
# Args:
#   $1 - plugin_operation: "merge" to combine plugins, "overwrite" to replace
#   $2 - base_file: Path to the base config file
#   $3 - diff_file: Path to the differences file
#   $4 - final_file: Output path for the merged file
# Returns:
#   0 - Success
#   1 - Invalid operation specified
config::merge_plugin_configs() {
  local plugin_operation=$1
  local base_file=$2
  local diff_file=$3
  local final_file=$4
  local temp_file="$final_file.tmp"

  if [[ -z "$plugin_operation" || -z "$base_file" || -z "$diff_file" || -z "$final_file" ]]; then
    log::error "Missing required parameters"
    log::info "Usage: helm::merge_values <operation> <base_file> <diff_file> <output_file>"
    return 1
  fi

  if [[ "$plugin_operation" != "merge" && "$plugin_operation" != "overwrite" ]]; then
    log::error "Invalid operation with plugins key: $plugin_operation (expected 'merge' or 'overwrite')"
    return 1
  fi

  if [[ "$base_file" == "$final_file" ]]; then
    rm -f "$temp_file"
    mv "$final_file" "$temp_file"
    base_file=$temp_file
  fi

  if [[ "$plugin_operation" == "merge" ]]; then
    yq eval-all '
      select(fileIndex == 0) *+ select(fileIndex == 1) |
      .plugins |= (reverse | unique_by(.package) | reverse)
    ' "${base_file}" "${diff_file}" > "${final_file}"
  elif [[ "$plugin_operation" == "overwrite" ]]; then
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1)
    ' "${base_file}" "${diff_file}" > "${final_file}"
  fi

  rm -f "$temp_file"
} 
