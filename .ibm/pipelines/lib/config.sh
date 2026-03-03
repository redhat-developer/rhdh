#!/usr/bin/env bash

# Configuration management utilities for CI pipelines
# Handles ConfigMap creation, dynamic plugins, and app configuration
# Dependencies: oc, yq, lib/log.sh, lib/common.sh

# Prevent re-sourcing
if [[ -n "${CONFIG_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly CONFIG_LIB_SOURCED=1

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ibm/pipelines/lib/common.sh
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

# Add explicit plugin paths for ghcr.io plugins to avoid network calls during auto-detection
# This is needed for OSD-GCP where ghcr.io is not accessible during init container execution
# Args:
#   $1 - namespace: Target namespace
#   $2 - configmap_name: Name of the ConfigMap (default: dynamic-plugins)
# Returns:
#   0 - Success
config::add_explicit_plugin_paths_osd_gcp() {
  local namespace=$1
  local configmap_name="${2:-dynamic-plugins}"

  if [[ -z "$namespace" ]]; then
    log::error "Missing required parameter: namespace"
    log::info "Usage: config::add_explicit_plugin_paths_osd_gcp <namespace> [configmap_name]"
    return 1
  fi

  log::info "Adding explicit plugin paths for ghcr.io plugins in ConfigMap ${configmap_name} (OSD-GCP cannot reach ghcr.io for auto-detection)"

  # Map of plugin packages to their explicit plugin paths (to avoid network calls for auto-detection)
  # Format: "package:version" -> "plugin-path"
  # Note: For plugins with version patterns, we match on the base image path (without version)
  declare -A plugin_paths=(
    ["oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-community-plugin-scaffolder-backend-module-quay:bs_1.45.3__2.14.0"]="backstage-community-plugin-scaffolder-backend-module-quay"
    ["oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-community-plugin-nexus-repository-manager:bs_1.45.3__1.19.4"]="backstage-community-plugin-nexus-repository-manager"
    ["oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-community-plugin-jenkins-backend:bs_1.45.3__0.22.0"]="backstage-community-plugin-jenkins-backend"
    ["oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-scaffolder-backend-module-bitbucket-cloud:bs_1.45.3__0.2.15"]="backstage-plugin-scaffolder-backend-module-bitbucket-cloud"
    ["oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-catalog-backend-module-bitbucket-cloud:bs_1.45.3__0.5.5"]="backstage-plugin-catalog-backend-module-bitbucket-cloud"
    # Also include the older version that might be in value files
    ["oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-scaffolder-backend-module-bitbucket-cloud:bs_1.45.3__0.2.15"]="backstage-plugin-scaffolder-backend-module-bitbucket-cloud"
  )

  # Get current ConfigMap content
  local current_yaml
  current_yaml=$(oc get cm "${configmap_name}" -n "${namespace}" -o jsonpath='{.data.dynamic-plugins\.yaml}' 2> /dev/null)

  if [[ -z "$current_yaml" ]]; then
    log::warn "ConfigMap ${configmap_name} not found or has no dynamic-plugins.yaml data in namespace ${namespace}"
    return 0
  fi

  # Create a temporary file with the current YAML
  local temp_file
  temp_file=$(mktemp)
  echo "$current_yaml" > "$temp_file"

  # Helper function to extract plugin path from image name
  # For ghcr.io plugins, the path is typically the last component before the tag
  extract_plugin_path() {
    local package="$1"
    # Remove oci:// prefix and extract the last path component before : or @
    echo "${package}" | sed -E 's|^oci://ghcr.io/[^/]+/[^/]+/([^:@]+).*|\1|'
  }

  # Update each plugin to include explicit plugin path
  local updated=false
  for plugin_package in "${!plugin_paths[@]}"; do
    local plugin_path="${plugin_paths[$plugin_package]}"
    local package_with_path="${plugin_package}!${plugin_path}"

    # Check if plugin exists without explicit path in the main plugins list
    local plugin_without_path
    plugin_without_path=$(yq eval ".plugins[] | select(.package == \"${plugin_package}\")" "$temp_file" 2> /dev/null)

    if [[ -n "$plugin_without_path" ]]; then
      # Plugin exists without explicit path, update it to include the path
      yq eval -i "(.plugins[] | select(.package == \"${plugin_package}\")).package = \"${package_with_path}\"" "$temp_file"
      log::info "Added explicit plugin path for: ${plugin_package} -> ${plugin_path}"
      updated=true
    else
      # Check if plugin exists with explicit path already in the main plugins list
      local plugin_with_path
      plugin_with_path=$(yq eval ".plugins[] | select(.package == \"${package_with_path}\")" "$temp_file" 2> /dev/null)

      if [[ -z "$plugin_with_path" ]]; then
        # Plugin doesn't exist in main plugins list, add it with explicit path
        # This ensures the plugin with explicit path is processed before catalog index plugins,
        # allowing it to override catalog index entries that don't have explicit paths
        # Initialize plugins array if it doesn't exist
        if ! yq eval '.plugins' "$temp_file" > /dev/null 2>&1; then
          yq eval -i '.plugins = []' "$temp_file"
        fi
        yq eval -i ".plugins += [{\"package\": \"${package_with_path}\"}]" "$temp_file"
        log::info "Added plugin with explicit path to override catalog index: ${package_with_path}"
        updated=true
      fi
    fi
  done

  # Also add any ghcr.io plugins from the value files that might not be in our explicit list
  # Extract all ghcr.io plugins from the ConfigMap and ensure they have explicit paths
  local all_ghcr_plugins
  all_ghcr_plugins=$(yq eval '.plugins[] | select(.package | startswith("oci://ghcr.io")) | .package' "$temp_file" 2> /dev/null || true)

  if [[ -n "$all_ghcr_plugins" ]]; then
    while IFS= read -r plugin_package; do
      [[ -z "$plugin_package" ]] && continue

      # Skip if already has explicit path (!)
      if [[ "$plugin_package" == *"!"* ]]; then
        continue
      fi

      # Check if this plugin is already in our explicit list
      local found=false
      for known_package in "${!plugin_paths[@]}"; do
        # Compare base image path (without version)
        local base_known="${known_package%%:*}"
        local base_plugin="${plugin_package%%:*}"
        if [[ "$base_known" == "$base_plugin" ]]; then
          found=true
          break
        fi
      done

      # If not in our list, infer the plugin path from the image name
      if [[ "$found" == "false" ]]; then
        local inferred_path
        inferred_path=$(extract_plugin_path "$plugin_package")
        local package_with_inferred_path="${plugin_package}!${inferred_path}"

        # Update the plugin to include the inferred path
        yq eval -i "(.plugins[] | select(.package == \"${plugin_package}\")).package = \"${package_with_inferred_path}\"" "$temp_file"
        log::info "Added inferred plugin path for: ${plugin_package} -> ${inferred_path}"
        updated=true
      fi
    done <<< "$all_ghcr_plugins"
  fi

  if [[ "$updated" == "true" ]]; then
    # Update the ConfigMap with the modified YAML
    local updated_yaml
    updated_yaml=$(cat "$temp_file")
    oc patch cm "${configmap_name}" -n "${namespace}" --type merge \
      -p "{\"data\":{\"dynamic-plugins.yaml\":$(echo "$updated_yaml" | jq -Rs .)}}"
    log::success "Updated ConfigMap ${configmap_name} to include explicit plugin paths for ghcr.io plugins"
  else
    log::info "No updates needed for ConfigMap ${configmap_name}"
  fi

  rm -f "$temp_file"
  return 0
}
