#!/usr/bin/env bash
#
# OpenShift Pull Request Job Handler
#

# Source required modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../env_variables.sh"
source "${SCRIPT_DIR}/../modules/constants.sh"
source "${SCRIPT_DIR}/../modules/retry.sh"
source "${SCRIPT_DIR}/../modules/logging.sh"
source "${SCRIPT_DIR}/../modules/platform/detection.sh"
source "${SCRIPT_DIR}/../modules/k8s-operations.sh"
source "${SCRIPT_DIR}/../modules/deployment/base.sh"
source "${SCRIPT_DIR}/../modules/deployment/rbac.sh"
source "${SCRIPT_DIR}/../modules/testing/backstage.sh"
source "${SCRIPT_DIR}/../modules/operators/cluster-setup.sh"
source "${SCRIPT_DIR}/../modules/helm.sh"

handle_ocp_pull() {
    log_info "=== OpenShift Pull Request Job ==="

    # Platform detection and setup
    detect_ocp
    detect_container_platform

    # Login to OpenShift
    oc_login

    # Get cluster router base
    export K8S_CLUSTER_ROUTER_BASE=$(get_cluster_router_base)
    log_info "Cluster router base: ${K8S_CLUSTER_ROUTER_BASE}"

    # Get chart version
    export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION:-1.8}")
    log_info "Using chart version: ${CHART_VERSION}"
    
    # Validate chart version
    validate_chart_version "${CHART_VERSION}" "${CHART_MAJOR_VERSION:-1.8}" || {
        log_error "Chart version validation failed"
        return 1
    }

    # Setup cluster with required operators
    log_info "Setting up OpenShift cluster with Helm"
    cluster_setup_ocp_helm

    # Deploy base RHDH instance (matching original behavior)
    log_info "Deploying base RHDH instance"
    base_deployment

    # Deploy RBAC instance (matching original behavior)
    log_info "Deploying RBAC RHDH instance"
    rbac_deployment

    # Deploy test backstage customization provider
    if [[ "${DEPLOY_TEST_CUSTOMIZATION:-true}" == "true" ]]; then
        deploy_test_backstage_customization_provider "${NAME_SPACE}"
    fi

    # Run tests for both deployments
    # Using constant for fullname override
    local url="https://${DEPLOYMENT_FULLNAME_OVERRIDE}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
    check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"

    local rbac_url="https://${DEPLOYMENT_FULLNAME_OVERRIDE}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
    check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"

    log_success "Pull request job completed successfully"
}

# Execute if called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    handle_ocp_pull
fi