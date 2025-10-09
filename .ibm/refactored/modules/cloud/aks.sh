#!/usr/bin/env bash
#
# Azure AKS Cloud Helper Module
# Provides Azure/AKS specific functions for deployments
#

# Guard to prevent multiple sourcing
if [[ -n "${_AKS_LOADED:-}" ]]; then
    return 0
fi
readonly _AKS_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../retry.sh"

# ============================================================================
# AZURE AUTHENTICATION
# ============================================================================

az_login() {
    log_info "Authenticating with Azure service principal..." >&2

    # Check required environment variables
    local required_vars=("ARM_CLIENT_ID" "ARM_CLIENT_SECRET" "ARM_TENANT_ID" "ARM_SUBSCRIPTION_ID")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            log_error "Required environment variable $var is not set" >&2
            return 1
        fi
    done

    # Login with service principal
    if az login --service-principal \
        -u "${ARM_CLIENT_ID}" \
        -p "${ARM_CLIENT_SECRET}" \
        --tenant "${ARM_TENANT_ID}" >/dev/null 2>&1; then
        log_success "Azure authentication successful" >&2
    else
        log_error "Azure authentication failed" >&2
        return 1
    fi

    # Set subscription
    if az account set --subscription "${ARM_SUBSCRIPTION_ID}" >/dev/null 2>&1; then
        log_success "Azure subscription set to ${ARM_SUBSCRIPTION_ID}" >&2
    else
        log_error "Failed to set Azure subscription" >&2
        return 1
    fi

    return 0
}

# ============================================================================
# AKS CLUSTER MANAGEMENT
# ============================================================================

az_aks_start() {
    local name="$1"
    local resource_group="$2"

    if [[ -z "$name" || -z "$resource_group" ]]; then
        log_error "Usage: az_aks_start <cluster_name> <resource_group>" >&2
        return 1
    fi

    log_info "Checking AKS cluster state: $name" >&2

    local power_state
    power_state=$(az aks show \
        --name="$name" \
        --resource-group "$resource_group" \
        --query 'powerState.code' \
        -o tsv 2>/dev/null)

    if [[ "$power_state" == "Running" ]]; then
        log_success "AKS cluster $name is already running" >&2
        return 0
    else
        log_warning "AKS cluster is not running (Current state: $power_state)" >&2
        log_info "Starting AKS cluster $name..." >&2

        if az aks start --name "$name" --resource-group "$resource_group" >/dev/null 2>&1; then
            log_success "AKS cluster $name started successfully" >&2
            return 0
        else
            log_error "Failed to start AKS cluster $name" >&2
            return 1
        fi
    fi
}

az_aks_stop() {
    local name="$1"
    local resource_group="$2"

    if [[ -z "$name" || -z "$resource_group" ]]; then
        log_error "Usage: az_aks_stop <cluster_name> <resource_group>" >&2
        return 1
    fi

    log_info "Stopping AKS cluster: $name" >&2

    if az aks stop --name "$name" --resource-group "$resource_group" >/dev/null 2>&1; then
        log_success "AKS cluster $name stopped successfully" >&2
        return 0
    else
        log_error "Failed to stop AKS cluster $name" >&2
        return 1
    fi
}

az_aks_get_credentials() {
    local name="$1"
    local resource_group="$2"

    if [[ -z "$name" || -z "$resource_group" ]]; then
        log_error "Usage: az_aks_get_credentials <cluster_name> <resource_group>" >&2
        return 1
    fi

    log_info "Getting AKS cluster credentials: $name" >&2

    if az aks get-credentials \
        --name="$name" \
        --resource-group="$resource_group" \
        --overwrite-existing >/dev/null 2>&1; then
        log_success "AKS credentials obtained successfully" >&2

        # Verify connectivity
        if kubectl cluster-info >/dev/null 2>&1; then
            log_success "Successfully connected to AKS cluster" >&2
            return 0
        else
            log_error "Failed to connect to AKS cluster after obtaining credentials" >&2
            return 1
        fi
    else
        log_error "Failed to get AKS credentials" >&2
        return 1
    fi
}

# ============================================================================
# AKS APP ROUTING
# ============================================================================

az_aks_approuting_enable() {
    local name="$1"
    local resource_group="$2"

    if [[ -z "$name" || -z "$resource_group" ]]; then
        log_error "Usage: az_aks_approuting_enable <cluster_name> <resource_group>" >&2
        return 1
    fi

    log_info "Enabling App Routing for AKS cluster: $name" >&2

    local output
    local exit_status

    set +e
    output=$(az aks approuting enable \
        --name "$name" \
        --resource-group "$resource_group" 2>&1 | sed 's/^ERROR: //')
    exit_status=$?
    set -e

    if [[ $exit_status -ne 0 ]]; then
        if [[ "$output" == *"App Routing is already enabled"* ]]; then
            log_info "App Routing is already enabled. Continuing..." >&2
            return 0
        else
            log_error "Failed to enable App Routing: $output" >&2
            return 1
        fi
    fi

    log_success "App Routing enabled successfully" >&2
    return 0
}

# ============================================================================
# AKS CLUSTER INFO
# ============================================================================

az_aks_get_cluster_info() {
    log_info "AKS Cluster Information:" >&2
    echo "========================" >&2

    # Get cluster version
    kubectl version --short 2>/dev/null | grep "Server Version" >&2 || echo "Server Version: Unable to determine" >&2

    # Get node information
    echo "Node Information:" >&2
    kubectl get nodes -o wide --no-headers 2>/dev/null | while read -r line; do
        echo "  $line" >&2
    done || echo "  Unable to get node information" >&2

    # Get installed addons
    echo "Installed Addons:" >&2

    # Check for common AKS addons
    local addons=("ingress-appgw" "http_application_routing" "monitoring" "azurepolicy")
    for addon in "${addons[@]}"; do
        if kubectl get pods -A 2>/dev/null | grep -q "$addon"; then
            echo "  - $addon: Installed" >&2
        fi
    done

    return 0
}

# ============================================================================
# AKS INGRESS CONFIGURATION
# ============================================================================

configure_aks_ingress() {
    local namespace="$1"
    local ingress_name="${2:-backstage}"

    log_info "Configuring AKS ingress in namespace: $namespace" >&2

    # Wait for ingress to be available
    log_info "Waiting for ingress $ingress_name to be available..." >&2

    local max_attempts=30
    local wait_seconds=10
    local ingress_hostname=""

    for ((i = 1; i <= max_attempts; i++)); do
        log_debug "Attempt $i of $max_attempts to get ingress hostname..." >&2

        # Get the ingress hostname
        ingress_hostname=$(kubectl get ingress "$ingress_name" -n "$namespace" \
            -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)

        # If not hostname, try IP
        if [[ -z "$ingress_hostname" ]]; then
            ingress_hostname=$(kubectl get ingress "$ingress_name" -n "$namespace" \
                -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
        fi

        if [[ -n "$ingress_hostname" ]]; then
            log_success "Successfully retrieved ingress address: $ingress_hostname" >&2
            break
        else
            log_debug "Ingress address not available yet, waiting $wait_seconds seconds..." >&2
            sleep "$wait_seconds"
        fi
    done

    if [[ -z "$ingress_hostname" ]]; then
        log_error "Failed to get ingress address after $max_attempts attempts" >&2
        return 1
    fi

    export AKS_INGRESS_HOSTNAME="$ingress_hostname"
    log_success "AKS ingress configuration completed successfully" >&2

    return 0
}

# ============================================================================
# AKS CLEANUP
# ============================================================================

cleanup_aks() {
    log_info "Starting AKS cleanup..." >&2

    # Note: Specific cleanup operations depend on what was deployed
    # This is a placeholder for job-specific cleanup
    log_info "AKS cleanup completed" >&2
    return 0
}

# Export functions
export -f az_login az_aks_start az_aks_stop az_aks_get_credentials
export -f az_aks_approuting_enable az_aks_get_cluster_info
export -f configure_aks_ingress cleanup_aks