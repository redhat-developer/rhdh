#!/usr/bin/env bash
#
# Operator Utilities Module - K8s/OCP RHDH Operator helpers
#

# Guard to prevent multiple sourcing
if [[ -n "${_OPERATOR_UTILS_LOADED:-}" ]]; then
    return 0
fi
readonly _OPERATOR_UTILS_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/k8s-operations.sh"

# Prepare operator pre-requisites (CRDs present, namespace created, etc.)
prepare_operator() {
    local retries="${1:-3}"
    log_info "Preparing operator environment (retries=${retries})"
    # Placeholder for any pre-flight needed in future (kept minimal intentionally)
    return 0
}

# Deploy a Backstage CR via operator YAML
deploy_rhdh_operator() {
    local namespace="$1"
    local operator_yaml="$2"

    log_info "Applying Backstage CR from ${operator_yaml} into namespace ${namespace}"
    kubectl apply -f "${operator_yaml}" -n "${namespace}"

    # Wait for primary deployment created by operator
    # Two common names depending on template flavor
    if ! wait_for_deployment "${namespace}" "redhat-developer-hub" 1200; then
        wait_for_deployment "${namespace}" "backstage" 1200 || true
    fi

    log_success "Backstage CR applied by operator in namespace ${namespace}"
}

# Cleanup operator-managed resources in a namespace
cleanup_operator() {
    local namespace="$1"
    log_info "Cleaning up operator-managed resources in ${namespace}"
    # Best-effort: delete Backstage CRs then remaining resources
    kubectl delete backstage --all -n "${namespace}" --ignore-not-found=true || true
    kubectl delete all --all -n "${namespace}" --ignore-not-found=true || true
    return 0
}

# Export functions
export -f prepare_operator deploy_rhdh_operator cleanup_operator


