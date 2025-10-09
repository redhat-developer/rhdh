#!/usr/bin/env bash
#
# OpenShift CI Tests - Main Entry Point
# Modular architecture with job handlers in separate files
#

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SCRIPT_DIR
export DIR="${SCRIPT_DIR}"
export OPENSHIFT_CI="${OPENSHIFT_CI:-false}"

# Source logging first for log functions
source "${SCRIPT_DIR}/modules/logging.sh"

# Load environment overrides for local testing
if [[ -z "${OPENSHIFT_CI}" || "${OPENSHIFT_CI}" == "false" ]]; then
    if [[ -f "${SCRIPT_DIR}/env_override.local.sh" ]]; then
        log_info "Loading local environment overrides"
        # shellcheck source=/dev/null
        source "${SCRIPT_DIR}/env_override.local.sh"
    fi
fi

# Source environment and core modules
source "${SCRIPT_DIR}/env_variables.sh"
source "${SCRIPT_DIR}/modules/constants.sh"
source "${SCRIPT_DIR}/modules/retry.sh"
source "${SCRIPT_DIR}/modules/platform/detection.sh"
source "${SCRIPT_DIR}/modules/k8s-operations.sh"
source "${SCRIPT_DIR}/modules/deployment/base.sh"
source "${SCRIPT_DIR}/modules/deployment/rbac.sh"
source "${SCRIPT_DIR}/modules/common.sh"
source "${SCRIPT_DIR}/modules/helm.sh"
source "${SCRIPT_DIR}/modules/reporting.sh"

# ============================================================================
# USAGE INFORMATION
# ============================================================================

show_usage() {
    cat <<EOF
OpenShift CI Tests - Modular Version

Usage: JOB_NAME=<job_type> $0

Job Types:
  pull/pr-*           - Pull request validation
  operator            - Operator deployment
  nightly             - Nightly comprehensive tests
  aks-helm/operator   - Azure AKS deployment
  eks-helm/operator   - AWS EKS deployment
  gke-helm/operator   - Google GKE deployment
  deploy              - Deploy base RHDH
  deploy-rbac         - Deploy RHDH with RBAC
  test                - Run tests only
  cleanup             - Clean up namespaces

Environment Variables:
  NAME_SPACE          - Base namespace (default: showcase)
  NAME_SPACE_RBAC     - RBAC namespace (default: showcase-rbac)
  RELEASE_NAME        - Helm release name (default: rhdh)
  QUAY_REPO           - Image repository
  TAG_NAME            - Image tag
  DEBUG               - Enable debug logging (true/false)

Examples:
  JOB_NAME=pull $0
  JOB_NAME=nightly NAME_SPACE=test-namespace $0

EOF
}

# ============================================================================
# JOB ROUTING
# ============================================================================

run_job() {
    local job_type="$1"
    local job_script=""

    # Determine which job script to execute
    case "${job_type}" in
        *pull*|*pr-*)
            job_script="${SCRIPT_DIR}/jobs/ocp-pull.sh"
            ;;
        aks-operator)
            job_script="${SCRIPT_DIR}/jobs/aks-operator.sh"
            ;;
        eks-operator)
            job_script="${SCRIPT_DIR}/jobs/eks-operator.sh"
            ;;
        gke-operator)
            job_script="${SCRIPT_DIR}/jobs/gke-operator.sh"
            ;;
        *operator*)
            job_script="${SCRIPT_DIR}/jobs/ocp-operator.sh"
            ;;
        *nightly*)
            job_script="${SCRIPT_DIR}/jobs/ocp-nightly.sh"
            ;;
        *aks-helm*)
            job_script="${SCRIPT_DIR}/jobs/aks-helm.sh"
            ;;
        *eks-helm*)
            job_script="${SCRIPT_DIR}/jobs/eks-helm.sh"
            ;;
        *gke-helm*)
            job_script="${SCRIPT_DIR}/jobs/gke-helm.sh"
            ;;
        auth-providers)
            job_script="${SCRIPT_DIR}/jobs/auth-providers.sh"
            ;;
        deploy)
            job_script="${SCRIPT_DIR}/jobs/deploy-base.sh"
            ;;
        deploy-rbac)
            job_script="${SCRIPT_DIR}/jobs/deploy-rbac.sh"
            ;;
        test)
            job_script="${SCRIPT_DIR}/jobs/run-tests.sh"
            ;;
        cleanup)
            job_script="${SCRIPT_DIR}/jobs/cleanup.sh"
            ;;
        *)
            log_error "Unknown job type: ${job_type}"
            show_usage
            exit 1
            ;;
    esac

    # Check if job script exists, otherwise execute built-in
    if [[ -f "${job_script}" ]]; then
        # Execute external job script
        log_info "Executing job script: ${job_script}"
        chmod +x "${job_script}"
        bash "${job_script}"
    else
        # Execute built-in job function
        log_info "Using built-in handler for: ${job_type}"
        execute_builtin_job "${job_type}"
    fi

    local exit_code=$?
    if [[ ${exit_code} -eq 0 ]]; then
        log_success "Job '${job_type}' completed successfully"
    else
        log_error "Job '${job_type}' failed with exit code: ${exit_code}"
    fi

    return ${exit_code}
}

# ============================================================================
# BUILT-IN JOB HANDLERS
# ============================================================================

execute_builtin_job() {
    local job_type="$1"

    log_info "Executing built-in job: ${job_type}"

    # Detect platform and login to cluster first
    detect_ocp
    detect_container_platform

    # Login to OpenShift/Kubernetes cluster if needed
    if [[ "${IS_OPENSHIFT}" == "true" ]]; then
        oc_login
    fi

    # Get cluster router base if not already set (for built-in jobs)
    if [[ -z "${K8S_CLUSTER_ROUTER_BASE:-}" ]]; then
        export K8S_CLUSTER_ROUTER_BASE=$(get_cluster_router_base)
        if [[ -n "${K8S_CLUSTER_ROUTER_BASE}" ]]; then
            log_info "Detected cluster router base: ${K8S_CLUSTER_ROUTER_BASE}"
        else
            log_warning "Could not detect cluster router base, using default"
            export K8S_CLUSTER_ROUTER_BASE="apps.example.com"
        fi
    fi

    # Get chart version if not already set
    if [[ -z "${CHART_VERSION:-}" ]]; then
        export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION:-1.7}")
        log_info "Using chart version: ${CHART_VERSION}"
        
        # Validate chart version matches expected major version
        if ! validate_chart_version "${CHART_VERSION}" "${CHART_MAJOR_VERSION:-1.7}"; then
            log_error "Chart version validation failed"
            return 1
        fi
        
        # Verify chart exists and is accessible
        if ! verify_helm_chart_exists "${HELM_CHART_URL}" "${CHART_VERSION}"; then
            log_error "Cannot access Helm chart, aborting"
            return 1
        fi
    fi

    # Optional pre-deployment cleanup
    if [[ "${FORCE_CLEANUP:-false}" == "true" ]]; then
        log_info "Force cleanup requested before deployment"
        cleanup_namespaces
    fi

    case "${job_type}" in
        deploy)
            log_info "Deploying base RHDH"
            base_deployment
            ;;
        deploy-rbac)
            log_info "Deploying RHDH with RBAC"
            rbac_deployment
            ;;
        test)
            log_info "Running tests"
            # Using constant for fullname override
            local url="https://${DEPLOYMENT_FULLNAME_OVERRIDE}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
            check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
            ;;
        cleanup)
            log_info "Cleaning up namespaces"
            cleanup_namespaces
            ;;
        *)
            log_error "Unknown built-in job type: ${job_type}"
            return 1
            ;;
    esac
}

# Cleanup function moved to modules/common.sh

# Pre-flight checks function moved to modules/common.sh

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    # Check if JOB_NAME is provided
    if [[ -z "${JOB_NAME:-}" ]]; then
        log_error "JOB_NAME environment variable is required"
        show_usage
        exit 1
    fi

    log_info "=========================================="
    log_info "  OpenShift CI Tests - Modular Version"
    log_info "=========================================="
    log_info "Job: ${JOB_NAME}"
    log_info "Directory: ${DIR}"

    # Initialize reporting
    init_reporting_directories

    # Run pre-flight checks
    preflight_checks

    # Execute the job
    run_job "${JOB_NAME}"
    local exit_code=$?

    # Generate summary report
    generate_summary_report

    # Save overall result
    save_overall_result $([[ ${exit_code} -eq 0 ]] && echo 0 || echo 1)

    # Send Slack notification if configured
    if [[ ${exit_code} -eq 0 ]]; then
        send_slack_notification "success" "Job completed successfully"
    else
        send_slack_notification "failure" "Job failed - check logs for details"
    fi

    exit ${exit_code}
}

# Handle script termination
trap 'log_error "Script interrupted"; exit 130' INT TERM

# Execute main function
main "$@"