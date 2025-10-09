#!/usr/bin/env bash
#
# OpenShift Nightly Job Handler
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
source "${SCRIPT_DIR}/../modules/orchestrator.sh"
source "${SCRIPT_DIR}/../modules/helm.sh"

handle_ocp_nightly() {
    log_info "=== OpenShift Nightly Job ==="

    # Override namespaces for nightly
    export NAME_SPACE="showcase-ci-nightly"
    export NAME_SPACE_RBAC="showcase-rbac-nightly"

    # Platform detection and setup
    detect_ocp
    detect_container_platform

    # Login to OpenShift
    oc_login

    # Get cluster router base
    export K8S_CLUSTER_ROUTER_BASE=$(get_cluster_router_base)

    # Get chart version
    export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION:-1.7}")
    log_info "Using chart version: ${CHART_VERSION}"
    
    # Validate chart version
    validate_chart_version "${CHART_VERSION}" "${CHART_MAJOR_VERSION:-1.7}" || {
        log_error "Chart version validation failed"
        return 1
    }

    # Enable orchestrator for nightly comprehensive testing
    log_info "Enabling orchestrator deployment for nightly tests"
    export DEPLOY_ORCHESTRATOR=true
    
    # Enable ACM for OCM plugin tests
    log_info "Enabling ACM installation for OCM plugin tests"
    export ENABLE_ACM=true
    
    # Use nightly value files (with orchestrator plugins)
    export HELM_CHART_VALUE_FILE_NAME="values_showcase_nightly.yaml"
    export HELM_CHART_RBAC_VALUE_FILE_NAME="values_showcase-rbac_nightly.yaml"

    # Setup cluster with all operators including orchestrator and ACM
    log_info "Setting up OpenShift cluster for nightly tests"
    cluster_setup_ocp_helm
    
    # Wait for MultiClusterHub to be ready before deploying RHDH
    if [[ "${ENABLE_ACM:-false}" == "true" ]]; then
        wait_until_mch_ready || log_warning "MCH not ready, OCM plugin may fail"
    fi

    # Clear any existing database
    clear_database

    # Deploy base RHDH with orchestrator enabled for nightly testing
    log_info "Deploying base RHDH for nightly testing (using ${HELM_CHART_VALUE_FILE_NAME})"
    base_deployment

    # Run comprehensive tests on base
    # Using constant for fullname override
    local base_url="https://${DEPLOYMENT_FULLNAME_OVERRIDE}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
    check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${base_url}"

    # Deploy RBAC RHDH with orchestrator enabled
    log_info "Deploying RBAC RHDH for nightly testing (using ${HELM_CHART_RBAC_VALUE_FILE_NAME})"
    rbac_deployment

    # Run comprehensive tests on RBAC
    local rbac_url="https://${DEPLOYMENT_FULLNAME_OVERRIDE}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
    check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"

    # Run E2E tests if enabled
    if [[ "${RUN_E2E_TESTS:-true}" == "true" ]]; then
        log_info "Running E2E tests"
        export RUN_API_TESTS="true"
        export RUN_UI_TESTS="true"
        run_e2e_tests "${NAME_SPACE}" "${base_url}"
    fi

    log_success "Nightly job completed successfully"
}

# Execute if called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    handle_ocp_nightly
fi