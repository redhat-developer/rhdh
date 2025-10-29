#!/usr/bin/env bash
#
# Upgrade Job - Test RHDH upgrade from previous release to current
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source core modules
source "${DIR}/env_variables.sh"
source "${DIR}/modules/constants.sh"
source "${DIR}/modules/logging.sh"
source "${DIR}/modules/platform/detection.sh"
source "${DIR}/modules/k8s-operations.sh"
source "${DIR}/modules/helm.sh"
source "${DIR}/modules/deployment/base.sh"
source "${DIR}/modules/testing/backstage.sh"
source "${DIR}/modules/reporting.sh"
source "${DIR}/modules/env/exporters.sh"
source "${DIR}/modules/operators/cluster-setup.sh"
source "${DIR}/modules/common.sh"

# ============================================================================
# UPGRADE SPECIFIC FUNCTIONS
# ============================================================================

initiate_upgrade_base_deployments() {
    local release_name="$1"
    local namespace="$2"
    local url="$3"

    log_info "Installing base release version ${CHART_VERSION_BASE} with tag ${TAG_NAME_BASE}"

    # Backup current values
    local original_chart_version="${CHART_VERSION}"
    local original_tag="${TAG_NAME}"
    local original_quay_repo="${QUAY_REPO}"

    # Set base version values
    export CHART_VERSION="${CHART_VERSION_BASE}"
    export TAG_NAME="${TAG_NAME_BASE}"
    export QUAY_REPO="${QUAY_REPO_BASE}"

    # Get previous release value file
    local base_value_file
    base_value_file=$(get_previous_release_value_file "showcase")

    if [[ ! -f "${base_value_file}" ]]; then
        log_error "Failed to get previous release value file"
        return 1
    fi

    # Deploy base version
    uninstall_helmchart "${namespace}" "${release_name}"

    local expected_hostname="${DEPLOYMENT_FULLNAME_OVERRIDE}-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"

    if ! helm_install_rhdh "${release_name}" "${namespace}" "${base_value_file}" "${expected_hostname}"; then
        log_error "Failed to install base version"
        # Restore original values
        export CHART_VERSION="${original_chart_version}"
        export TAG_NAME="${original_tag}"
        export QUAY_REPO="${original_quay_repo}"
        return 1
    fi

    # Wait for deployment to be ready
    wait_for_deployment "${DEPLOYMENT_NAME}" "${namespace}"

    # Test base deployment
    if ! test_backstage_health "${namespace}"; then
        log_error "Base deployment health check failed"
        export CHART_VERSION="${original_chart_version}"
        export TAG_NAME="${original_tag}"
        export QUAY_REPO="${original_quay_repo}"
        return 1
    fi

    log_success "Base deployment successful with version ${CHART_VERSION_BASE}"

    # Restore current values for upgrade
    export CHART_VERSION="${original_chart_version}"
    export TAG_NAME="${original_tag}"
    export QUAY_REPO="${original_quay_repo}"
}

initiate_upgrade_deployments() {
    local release_name="$1"
    local namespace="$2"
    local url="$3"

    log_info "Upgrading to version ${CHART_VERSION} with tag ${TAG_NAME}"

    # Get diff value file for upgrade
    local diff_value_file="${DIR}/value_files/diff-values_showcase_upgrade.yaml"

    if [[ ! -f "${diff_value_file}" ]]; then
        log_warning "Diff value file not found, using standard value file"
        diff_value_file="${DIR}/value_files/values_showcase.yaml"
    fi

    local expected_hostname="${DEPLOYMENT_FULLNAME_OVERRIDE}-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"

    # Perform helm upgrade
    if ! helm_install_rhdh "${release_name}" "${namespace}" "${diff_value_file}" "${expected_hostname}"; then
        log_error "Failed to upgrade to new version"
        return 1
    fi

    log_success "Upgrade command executed successfully"
}

check_upgrade_and_test() {
    local deployment_name="$1"
    local release_name="$2"
    local namespace="$3"
    local url="$4"

    log_info "Checking upgrade status and running tests"

    # Wait for rollout to complete
    if ! wait_for_deployment "${deployment_name}" "${namespace}"; then
        log_error "Upgrade rollout failed"

        # Attempt rollback
        log_info "Attempting to rollback to previous version"
        if helm rollback "${release_name}" -n "${namespace}"; then
            log_success "Rollback successful"
        else
            log_error "Rollback failed"
        fi
        return 1
    fi

    # Run health checks
    if ! test_backstage_health "${namespace}"; then
        log_error "Health check failed after upgrade"
        return 1
    fi

    # Run comprehensive tests
    if ! run_backstage_basic_tests "${namespace}"; then
        log_error "Basic tests failed after upgrade"
        return 1
    fi

    log_success "Upgrade completed and tested successfully"
}

handle_ocp_helm_upgrade() {
    export NAME_SPACE="showcase-upgrade-nightly"
    export NAME_SPACE_POSTGRES_DB="${NAME_SPACE}-postgres-external-db"
    export DEPLOYMENT_NAME="${RELEASE_NAME}-developer-hub"
    export QUAY_REPO_BASE="rhdh/rhdh-hub-rhel9"

    # Dynamically determine the previous release version and chart version
    local previous_release_version
    previous_release_version=$(get_previous_release_version "${CHART_MAJOR_VERSION}")

    if [[ -z "${previous_release_version}" ]]; then
        log_error "Failed to determine previous release version"
        save_overall_result 1
        exit 1
    fi

    CHART_VERSION_BASE=$(get_chart_version "${previous_release_version}")
    if [[ -z "${CHART_VERSION_BASE}" ]]; then
        log_error "Failed to determine chart version for ${previous_release_version}"
        save_overall_result 1
        exit 1
    fi

    export CHART_VERSION_BASE
    export TAG_NAME_BASE="${previous_release_version}"

    log_info "Previous release: ${previous_release_version}"
    log_info "Previous chart: ${CHART_VERSION_BASE}"
    log_info "Previous tag: ${TAG_NAME_BASE}"

    # Login to OpenShift
    oc_login

    # Get cluster router base
    export K8S_CLUSTER_ROUTER_BASE=$(get_cluster_router_base)
    log_info "Cluster router base: ${K8S_CLUSTER_ROUTER_BASE}"

    # Setup cluster
    cluster_setup_ocp_helm

    # Get current version
    export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION}")
    log_info "Current chart: ${CHART_VERSION}"
    log_info "Current tag: ${TAG_NAME}"

    # Initialize reporting
    init_reporting_directories

    # Setup namespace and prerequisites
    if ! setup_namespace "${NAME_SPACE}"; then
        log_error "Failed to setup namespace"
        save_overall_result 1
        exit 1
    fi

    # Deploy Redis
    if ! deploy_redis "${NAME_SPACE}"; then
        log_error "Failed to deploy Redis"
        save_overall_result 1
        exit 1
    fi

    # Apply base configurations
    if ! apply_yaml_files "${DIR}" "${NAME_SPACE}"; then
        log_error "Failed to apply YAML configurations"
        save_overall_result 1
        exit 1
    fi

    local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"

    # Perform upgrade sequence
    if initiate_upgrade_base_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"; then
        log_success "Base deployment successful"

        # Deploy orchestrator workflows if enabled
        if [[ "${DEPLOY_ORCHESTRATOR:-false}" == "true" ]]; then
            log_info "Deploying orchestrator workflows"
            deploy_orchestrator_workflows "${NAME_SPACE}"
        fi

        if initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"; then
            log_success "Upgrade deployment successful"

            if check_upgrade_and_test "${DEPLOYMENT_NAME}" "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"; then
                log_success "Upgrade test completed successfully"
                save_overall_result 0
            else
                log_error "Upgrade test failed"
                save_overall_result 1
            fi
        else
            log_error "Upgrade deployment failed"
            save_overall_result 1
        fi
    else
        log_error "Base deployment failed"
        save_overall_result 1
    fi

    # Generate report
    generate_summary_report
}

# ============================================================================
# MAIN
# ============================================================================

# Detect if running from OpenShift CI or locally
if [[ "${OPENSHIFT_CI}" == "true" ]] || [[ -n "${JOB_NAME}" && "${JOB_NAME}" == *"upgrade"* ]]; then
    handle_ocp_helm_upgrade
else
    log_error "This job should be run from OpenShift CI or with JOB_NAME containing 'upgrade'"
    exit 1
fi