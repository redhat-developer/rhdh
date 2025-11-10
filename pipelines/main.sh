#!/bin/bash
# Main entry point for RHDH CI/CD Pipeline
# This script routes jobs to appropriate handlers based on JOB_NAME pattern

set -euo pipefail

# ============================================================================
# Script Directory Detection
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PIPELINES_ROOT="${SCRIPT_DIR}"

# ============================================================================
# Local Development Variables (set before sourcing core/env.sh)
# ============================================================================
#export JOB_NAME="pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm-pull"
#export TAG_NAME="next"
#export PULL_NUMBER="next"
#export BUILD_ID="test-build"
#export K8S_CLUSTER_TOKEN=""
#export K8S_CLUSTER_URL=""

# ============================================================================
# Source Core Modules
# ============================================================================
# shellcheck source=core/env.sh
source "${PIPELINES_ROOT}/core/env.sh"
# shellcheck source=core/logging.sh
source "${PIPELINES_ROOT}/core/logging.sh"
# shellcheck source=core/reporting.sh
source "${PIPELINES_ROOT}/core/reporting.sh"


# ============================================================================
# Initialization
# ============================================================================
log_section "RHDH CI/CD Pipeline - Main Entry Point"

# Initialize log file
init_log_file

# Record start time
START_TIME=$(date +%s)

log_info "Pipeline Root: ${PIPELINES_ROOT}"
log_info "Project Root: ${PROJECT_ROOT}"
log_info "Job Name: ${JOB_NAME}"
log_info "Build ID: ${BUILD_ID}"

# ============================================================================
# Error Handling Setup
# ============================================================================
# Setup error trapping for better debugging
setup_error_trap

# Cleanup on exit
cleanup() {
  local exit_code=$?

  log_section "Pipeline Cleanup"

  # Calculate duration
  local end_time=$(date +%s)
  local duration=$(calculate_duration ${START_TIME} ${end_time})
  log_info "Total execution time: ${duration}"

  # Generate final summary if we ran any deployments
  if [[ ${CURRENT_DEPLOYMENT} -gt 0 ]]; then
    generate_summary_report
  fi

  if [[ ${exit_code} -eq 0 ]]; then
    log_success "Pipeline completed successfully"
  else
    log_error "Pipeline completed with errors (exit code: ${exit_code})"
  fi

  exit ${exit_code}
}

trap cleanup EXIT

# ============================================================================
# Job Router
# ============================================================================
# Route to appropriate job handler based on JOB_NAME pattern

log_section "Job Routing"
log_info "Analyzing job name: ${JOB_NAME}"

case "${JOB_NAME}" in
  *pull*ocp*helm*)
    log_info "Detected OCP Pull job pattern"
    log_info "Loading OCP Pull job handler"

    # shellcheck source=jobs/ocp-pull/handler.sh
    source "${PIPELINES_ROOT}/jobs/ocp-pull/handler.sh"

    log_info "Executing OCP Pull handler"
    handle_ocp_pull
    ;;

  *nightly*ocp*helm*)
    log_info "Detected OCP Nightly Helm job"
    # shellcheck source=jobs/ocp-nightly/handler.sh
    source "${PIPELINES_ROOT}/jobs/ocp-nightly/handler.sh"
    handle_ocp_nightly
    ;;

  *upgrade*ocp*helm*)
    log_info "Detected OCP Upgrade Helm job"
    # shellcheck source=jobs/ocp-upgrade/handler.sh
    source "${PIPELINES_ROOT}/jobs/ocp-upgrade/handler.sh"
    handle_ocp_upgrade
    ;;

  *aks*helm*)
    log_info "Detected AKS Helm job"
    # shellcheck source=jobs/aks/handler.sh
    source "${PIPELINES_ROOT}/jobs/aks/handler.sh"
    handle_aks
    ;;

  *eks*helm*)
    log_info "Detected EKS Helm job"
    # shellcheck source=jobs/eks/handler.sh
    source "${PIPELINES_ROOT}/jobs/eks/handler.sh"
    handle_eks
    ;;

  *gke*helm*)
    log_info "Detected GKE Helm job"
    # shellcheck source=jobs/gke/handler.sh
    source "${PIPELINES_ROOT}/jobs/gke/handler.sh"
    handle_gke
    ;;

  *refactored*)
    log_info "Detected refactored OCP Helm job"
    # shellcheck source=jobs/ocp-pull/handler.sh
    source "${PIPELINES_ROOT}/jobs/ocp-pull/handler.sh"
    handle_ocp_pull
    ;;

  *operator*)
    log_info "Detected Operator job"
    # shellcheck source=jobs/operator/handler.sh
    source "${PIPELINES_ROOT}/jobs/operator/handler.sh"
    handle_operator
    ;;

  *)
    log_error "Unknown job pattern: ${JOB_NAME}"
    log_info "Available job patterns:"
    log_info "  - *pull*ocp*helm* : OpenShift Pull Request testing"
    log_info ""
    log_info "Future patterns (not yet implemented):"
    log_info "  - *nightly*ocp*helm* : OpenShift Nightly testing"
    log_info "  - *upgrade*ocp*helm* : OpenShift Upgrade testing"
    log_info "  - *aks*helm* : Azure Kubernetes Service testing"
    log_info "  - *eks*helm* : Amazon EKS testing"
    log_info "  - *gke*helm* : Google GKE testing"
    log_info "  - *operator* : Operator-based deployments"
    exit 1
    ;;
esac

# ============================================================================
# Exit with proper code
# ============================================================================
exit ${OVERALL_RESULT}

