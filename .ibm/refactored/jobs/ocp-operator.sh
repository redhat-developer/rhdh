#!/usr/bin/env bash
#
# OpenShift Operator Job Handler
#

# Source required modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../env_variables.sh"
source "${SCRIPT_DIR}/../modules/logging.sh"
source "${SCRIPT_DIR}/../modules/platform/detection.sh"
source "${SCRIPT_DIR}/../modules/k8s-operations.sh"
source "${SCRIPT_DIR}/../modules/operators/cluster-setup.sh"
source "${SCRIPT_DIR}/../modules/helm.sh"

handle_ocp_operator() {
    log_info "=== OpenShift Operator Job ==="

    # Platform detection
    detect_ocp
    detect_container_platform

    # Login to OpenShift
    oc_login

    # Get cluster router base
    export K8S_CLUSTER_ROUTER_BASE=$(get_cluster_router_base)

    # Get chart version
    export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION:-1.8}")
    log_info "Using chart version: ${CHART_VERSION}"

    # Setup cluster for operator
    cluster_setup_ocp_operator

    # Deploy base with operator
    log_info "Deploying RHDH with operator to ${NAME_SPACE}"
    configure_namespace "${NAME_SPACE}"

    # Deploy RHDH operator instance
    kubectl apply -f "${DIR}/resources/rhdh-operator/rhdh-start.yaml" -n "${NAME_SPACE}"

    # Wait for deployment
    wait_for_deployment "${NAME_SPACE}" "backstage-${RELEASE_NAME}" 600

    # Check deployment
    local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
    log_info "RHDH deployed at: ${url}"

    # Deploy RBAC with operator if enabled
    if [[ "${DEPLOY_RBAC:-true}" == "true" ]]; then
        log_info "Deploying RHDH with RBAC using operator"
        configure_namespace "${NAME_SPACE_RBAC}"

        # Setup RBAC policies
        kubectl apply -f "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml" -n "${NAME_SPACE_RBAC}"

        # Wait for deployment
        wait_for_deployment "${NAME_SPACE_RBAC}" "backstage-${RELEASE_NAME_RBAC}" 600

        local rbac_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
        log_info "RHDH RBAC deployed at: ${rbac_url}"
    fi

    log_success "Operator job completed successfully"
}

# Execute if called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    handle_ocp_operator
fi