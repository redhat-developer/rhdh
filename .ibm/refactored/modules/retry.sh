#!/usr/bin/env bash
#
# Retry Library - Generic retry mechanisms with proper error handling
#

# Guard to prevent multiple sourcing
if [[ -n "${_RETRY_LOADED:-}" ]]; then
    return 0
fi
readonly _RETRY_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/constants.sh"

# ============================================================================
# GENERIC RETRY FUNCTION
# ============================================================================

# Generic retry function that executes a command with exponential backoff
# Usage: with_retry <max_retries> <initial_delay> <command> [args...]
# Returns: Exit code of the command (0 on success, non-zero on failure)
with_retry() {
    local max_retries="${1}"
    local initial_delay="${2}"
    shift 2
    local cmd=("$@")
    
    local attempt=1
    local delay="${initial_delay}"
    local last_exit_code=0
    
    while [[ ${attempt} -le ${max_retries} ]]; do
        log_debug "Executing (attempt ${attempt}/${max_retries}): ${cmd[*]}"
        
        # Execute command and capture output and exit code
        local output
        local exit_code
        
        if output=$("${cmd[@]}" 2>&1); then
            log_debug "Command succeeded on attempt ${attempt}"
            return 0
        else
            exit_code=$?
            last_exit_code=${exit_code}
            
            if [[ ${attempt} -lt ${max_retries} ]]; then
                log_warning "Command failed (exit code: ${exit_code}), retrying in ${delay}s... (attempt ${attempt}/${max_retries})"
                log_debug "Error output: ${output}"
                sleep "${delay}"
                
                # Exponential backoff with max delay of 60s
                delay=$((delay * 2))
                [[ ${delay} -gt 60 ]] && delay=60
            else
                log_error "Command failed after ${max_retries} attempts (exit code: ${exit_code})"
                log_error "Last error output: ${output}"
            fi
        fi
        
        attempt=$((attempt + 1))
    done
    
    return ${last_exit_code}
}

# ============================================================================
# KUBERNETES RESOURCE RETRY FUNCTIONS
# ============================================================================

# Apply Kubernetes resource with retry and proper error reporting
apply_resource_with_retry() {
    local resource_yaml="$1"
    local namespace="${2:-}"
    local max_retries="${3:-${RETRY_APPLY_RESOURCE}}"
    local retry_delay="${4:-${RETRY_DELAY_DEFAULT}}"
    
    log_info "Applying Kubernetes resource with retry (max ${max_retries} attempts)"
    
    local cmd="kubectl apply -f -"
    [[ -n "${namespace}" ]] && cmd="kubectl apply -n ${namespace} -f -"
    
    local attempt=1
    local delay="${retry_delay}"
    
    while [[ ${attempt} -le ${max_retries} ]]; do
        local output
        local exit_code
        
        if output=$(echo "${resource_yaml}" | ${cmd} 2>&1); then
            log_success "Resource applied successfully"
            echo "${output}"
            return 0
        else
            exit_code=$?
            
            if [[ ${attempt} -lt ${max_retries} ]]; then
                log_warning "Apply failed (attempt ${attempt}/${max_retries}), retrying in ${delay}s..."
                log_debug "Error: ${output}"
                sleep "${delay}"
                delay=$((delay * 2))
                [[ ${delay} -gt 60 ]] && delay=60
            else
                log_error "Failed to apply resource after ${max_retries} attempts"
                log_error "Error output: ${output}"
                return ${exit_code}
            fi
        fi
        
        attempt=$((attempt + 1))
    done
    
    return 1
}

# Wait for Kubernetes resource with timeout and retry
wait_for_resource() {
    local resource_type="$1"
    local resource_name="$2"
    local namespace="$3"
    local condition="${4:-available}"
    local timeout="${5:-${TIMEOUT_DEPLOYMENT_DEFAULT}}"
    
    log_info "Waiting for ${resource_type}/${resource_name} to be ${condition} (timeout: ${timeout}s)"
    
    # First check if resource exists
    if ! with_retry 5 2 kubectl get "${resource_type}" "${resource_name}" -n "${namespace}" &>/dev/null; then
        log_error "Resource ${resource_type}/${resource_name} does not exist in namespace ${namespace}"
        return 1
    fi
    
    # Wait for condition
    if kubectl wait --for=condition="${condition}" \
        --timeout="${timeout}s" \
        "${resource_type}/${resource_name}" \
        -n "${namespace}" 2>&1; then
        log_success "Resource ${resource_type}/${resource_name} is ${condition}"
        return 0
    else
        log_error "Resource ${resource_type}/${resource_name} failed to become ${condition} within ${timeout}s"
        
        # Show resource status for debugging
        kubectl get "${resource_type}" "${resource_name}" -n "${namespace}" -o yaml 2>&1 || true
        
        return 1
    fi
}

# ============================================================================
# HEALTH CHECK RETRY FUNCTIONS
# ============================================================================

# Execute health check with retry and exponential backoff
health_check_with_retry() {
    local url="$1"
    local max_retries="${2:-${RETRY_HEALTH_CHECK}}"
    local initial_delay="${3:-${RETRY_DELAY_HEALTH_CHECK}}"
    
    log_info "Running health check with retry (max ${max_retries} attempts)"
    
    local attempt=1
    local delay="${initial_delay}"
    
    while [[ ${attempt} -le ${max_retries} ]]; do
        local response_code
        
        response_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --connect-timeout "${TIMEOUT_HEALTH_CHECK_CONNECT}" \
            --max-time "${TIMEOUT_HEALTH_CHECK}" \
            "${url}/api/health" 2>/dev/null || echo "000")
        
        if [[ "${response_code}" == "200" ]]; then
            log_success "Health check passed (HTTP ${response_code})"
            return 0
        elif [[ "${response_code}" == "000" ]]; then
            if [[ ${attempt} -lt ${max_retries} ]]; then
                log_warning "Could not connect to ${url} (attempt ${attempt}/${max_retries}), retrying in ${delay}s..."
                sleep "${delay}"
                delay=$((delay * 2))
                [[ ${delay} -gt 60 ]] && delay=60
            else
                log_error "Health check failed - could not connect after ${max_retries} attempts"
            fi
        else
            if [[ ${attempt} -lt ${max_retries} ]]; then
                log_warning "Health check returned HTTP ${response_code} (attempt ${attempt}/${max_retries}), retrying in ${delay}s..."
                sleep "${delay}"
                delay=$((delay * 2))
                [[ ${delay} -gt 60 ]] && delay=60
            else
                log_error "Health check failed with HTTP ${response_code} after ${max_retries} attempts"
            fi
        fi
        
        attempt=$((attempt + 1))
    done
    
    return 1
}

# Export functions
export -f with_retry apply_resource_with_retry wait_for_resource health_check_with_retry

