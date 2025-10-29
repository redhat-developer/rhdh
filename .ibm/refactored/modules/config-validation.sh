#!/usr/bin/env bash
#
# Configuration Validation Module - Validates and normalizes configurations
# Handles base64 decoding, missing configs, and URL validation
#
set -euo pipefail

# Guard to prevent multiple sourcing
if [[ -n "${_CONFIG_VALIDATION_LOADED:-}" ]]; then
    return 0
fi
readonly _CONFIG_VALIDATION_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"

# ============================================================================
# BASE64 DETECTION AND DECODING
# ============================================================================

# Check if a string is base64 encoded
is_base64() {
    local str="$1"

    # Check if string matches base64 pattern
    if [[ "$str" =~ ^[A-Za-z0-9+/]*={0,2}$ ]]; then
        # Try to decode and check if result is valid
        local decoded
        decoded=$(echo "$str" | base64 -d 2>/dev/null) || return 1

        # Check if decoded string looks like a URL or valid text
        if [[ "$decoded" =~ ^https?:// ]] || [[ "$decoded" =~ ^[[:print:]]+$ ]]; then
            return 0
        fi
    fi

    return 1
}

# Decode base64 if needed
decode_if_base64() {
    local value="$1"

    if is_base64 "$value"; then
        echo "$value" | base64 -d
    else
        echo "$value"
    fi
}

# ============================================================================
# CONFIGURATION VALIDATION AND NORMALIZATION
# ============================================================================

# Fix OCM cluster URL if it's base64 encoded
fix_ocm_cluster_url() {
    if [[ -n "${OCM_CLUSTER_URL:-}" ]]; then
        local decoded_url
        decoded_url=$(decode_if_base64 "${OCM_CLUSTER_URL}")

        if [[ "$decoded_url" != "$OCM_CLUSTER_URL" ]]; then
            log_info "Decoded OCM_CLUSTER_URL from base64"
            export OCM_CLUSTER_URL="$decoded_url"
        fi
    fi

    # Also check K8S_CLUSTER_API_SERVER_URL
    if [[ -n "${K8S_CLUSTER_API_SERVER_URL:-}" ]]; then
        local decoded_url
        decoded_url=$(decode_if_base64 "${K8S_CLUSTER_API_SERVER_URL}")

        if [[ "$decoded_url" != "$K8S_CLUSTER_API_SERVER_URL" ]]; then
            log_info "Decoded K8S_CLUSTER_API_SERVER_URL from base64"
            export K8S_CLUSTER_API_SERVER_URL="$decoded_url"
        fi
    fi
}

# Add missing GitLab integration config
add_gitlab_integration_config() {
    local config_file="$1"

    # Check if GitLab integration is already configured
    if grep -q "integrations:" "$config_file" && grep -q "gitlab:" "$config_file"; then
        log_debug "GitLab integration already configured"
        return 0
    fi

    log_info "Adding GitLab integration configuration"

    # Create GitLab integration config
    cat >> "$config_file" <<EOF

integrations:
  gitlab:
    - host: gitlab.com
      apiBaseUrl: https://gitlab.com/api/v4
      # token: \${GITLAB_TOKEN}  # Uncomment and set if you have a GitLab token
EOF
}

# Add missing tech-radar config
add_tech_radar_config() {
    local config_file="$1"

    # Check if tech-radar is already configured
    if grep -q "techRadar:" "$config_file"; then
        log_debug "Tech Radar already configured"
        return 0
    fi

    log_info "Adding Tech Radar configuration"

    # Create tech-radar config
    cat >> "$config_file" <<EOF

techRadar:
  url: https://github.com/redhat-developer/rhdh/blob/main/packages/app/public/tech-radar/data.json
EOF
}

# Validate and fix all known configuration issues
apply_config_fixes() {
    local namespace="${1}"
    local config_map_name="${2:-app-config-rhdh}"

    log_info "Applying configuration fixes"

    # Fix base64 encoded URLs
    fix_ocm_cluster_url

    # Get the current configmap if it exists
    if kubectl get configmap "$config_map_name" -n "$namespace" &>/dev/null; then
        log_info "Updating existing ConfigMap: $config_map_name"

        # Export current config to temp file
        local temp_config="/tmp/${config_map_name}-fixed.yaml"
        kubectl get configmap "$config_map_name" -n "$namespace" \
            -o jsonpath='{.data.app-config-rhdh\.yaml}' > "$temp_config"

        # Apply fixes to the config file
        add_gitlab_integration_config "$temp_config"
        add_tech_radar_config "$temp_config"

        # Update the ConfigMap
        kubectl create configmap "$config_map_name" \
            --from-file=app-config-rhdh.yaml="$temp_config" \
            -n "$namespace" \
            --dry-run=client -o yaml | \
            kubectl replace -f -

        # Clean up temp file
        rm -f "$temp_config"

        log_success "Configuration fixes applied"
    else
        log_warning "ConfigMap $config_map_name not found in namespace $namespace"
    fi
}

# ============================================================================
# EXPORT FUNCTIONS
# ============================================================================

export -f is_base64 decode_if_base64 fix_ocm_cluster_url
export -f add_gitlab_integration_config add_tech_radar_config
export -f apply_config_fixes