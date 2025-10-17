#!/usr/bin/env bash
#
# Deploy Base Job - Standard RHDH deployment
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/../env_variables.sh"
source "${SCRIPT_DIR}/../modules/constants.sh"
source "${SCRIPT_DIR}/../modules/retry.sh"
source "${SCRIPT_DIR}/../modules/logging.sh"
source "${SCRIPT_DIR}/../modules/platform/detection.sh"
source "${SCRIPT_DIR}/../modules/k8s-operations.sh"
source "${SCRIPT_DIR}/../modules/deployment/base.sh"
source "${SCRIPT_DIR}/../modules/testing/backstage.sh"
source "${SCRIPT_DIR}/../modules/reporting.sh"
source "${SCRIPT_DIR}/../modules/helm.sh"
source "${SCRIPT_DIR}/../modules/env/exporters.sh"

main() {
    log_info "=========================================="
    log_info "  Deploy Base RHDH"
    log_info "=========================================="

    # Platform detection and setup
    detect_ocp
    detect_container_platform
    
    # Export provider environment variables
    export_default_providers_env

    # Login to OpenShift if needed
    if [[ "${IS_OPENSHIFT}" == "true" ]]; then
        oc_login
    fi

    # Get cluster router base
    export K8S_CLUSTER_ROUTER_BASE=$(get_cluster_router_base)
    log_info "Cluster router base: ${K8S_CLUSTER_ROUTER_BASE}"

    # Get chart version
    export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION:-1.8}")
    log_info "Using chart version: ${CHART_VERSION}"
    
    # Validate chart version
    if ! validate_chart_version "${CHART_VERSION}" "${CHART_MAJOR_VERSION:-1.8}"; then
        log_error "Chart version validation failed, aborting"
        exit 1
    fi

    # Initialize reporting
    init_reporting_directories

    # Deploy base
    if base_deployment; then
        log_success "Base deployment successful"

        # Run tests if enabled
        if [[ "${RUN_TESTS_AFTER_DEPLOY:-true}" == "true" ]]; then
            # Using constant for fullname override
            local url="https://${DEPLOYMENT_FULLNAME_OVERRIDE}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
            if check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"; then
                save_overall_result 0
            else
                save_overall_result 1
            fi
        else
            save_overall_result 0
        fi
    else
        log_error "Base deployment failed"
        save_overall_result 1
        exit 1
    fi

    # Generate report
    generate_summary_report
}

main "$@"