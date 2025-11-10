#!/bin/bash
# Cleanup script for RHDH CI/CD Pipeline
# Removes test namespaces and resources after testing

set -euo pipefail

# ============================================================================
# Script Directory Detection
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PIPELINES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ============================================================================
# Source Core Modules
# ============================================================================
# shellcheck source=../core/env.sh
source "${PIPELINES_ROOT}/core/env.sh"
# shellcheck source=../core/logging.sh
source "${PIPELINES_ROOT}/core/logging.sh"
# shellcheck source=../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"

# ============================================================================
# Cleanup Functions
# ============================================================================

# Clean up a specific namespace
# Usage: cleanup_namespace <namespace>
cleanup_namespace() {
  local namespace=$1
  
  log_info "Cleaning up namespace: ${namespace}"
  
  if ! oc get namespace "${namespace}" > /dev/null 2>&1; then
    log_info "Namespace ${namespace} does not exist, skipping"
    return 0
  fi
  
  # Remove finalizers from stuck resources
  remove_finalizers_from_resources "${namespace}"
  
  # Delete the namespace
  delete_namespace "${namespace}"
  
  log_success "Namespace ${namespace} cleaned up"
}

# Clean up all test namespaces
# Usage: cleanup_all_test_namespaces
cleanup_all_test_namespaces() {
  log_section "Cleaning Up All Test Namespaces"
  
  local namespaces=(
    "${NAME_SPACE}"
    "${NAME_SPACE_RBAC}"
    "${NAME_SPACE_POSTGRES_DB}"
  )
  
  for ns in "${namespaces[@]}"; do
    cleanup_namespace "${ns}"
  done
  
  log_success "All test namespaces cleaned up"
}

# Clean up temporary files and directories
# Usage: cleanup_temp_files
cleanup_temp_files() {
  log_section "Cleaning Up Temporary Files"
  
  local temp_files=(
    "/tmp/yarn.install.log.txt"
    "/tmp/${LOGFILE}"
    "/tmp/${LOGFILE}.html"
    "/tmp/step-without-plugins.yaml"
    "/tmp/step-only-plugins.yaml"
    "/tmp/merged_value_file.yaml"
    "postgres-ca"
    "postgres-tls-crt"
    "postgres-tsl-key"
  )
  
  for file in "${temp_files[@]}"; do
    if [[ -f "${file}" ]]; then
      log_debug "Removing ${file}"
      rm -f "${file}"
    fi
  done
  
  # Clean up cloned workflows
  if [[ -d "${PIPELINES_ROOT}/serverless-workflows" ]]; then
    log_debug "Removing serverless-workflows directory"
    rm -rf "${PIPELINES_ROOT}/serverless-workflows"
  fi
  
  log_success "Temporary files cleaned up"
}

# Clean up test results and artifacts
# Usage: cleanup_test_artifacts [keep_artifacts]
cleanup_test_artifacts() {
  local keep_artifacts=${1:-false}
  
  if [[ "${keep_artifacts}" == "true" ]]; then
    log_info "Skipping test artifacts cleanup (keeping for analysis)"
    return 0
  fi
  
  log_section "Cleaning Up Test Artifacts"
  
  local e2e_dir="${PROJECT_ROOT}/e2e-tests"
  
  if [[ -d "${e2e_dir}/test-results" ]]; then
    log_debug "Removing ${e2e_dir}/test-results"
    rm -rf "${e2e_dir}/test-results"
  fi
  
  if [[ -d "${e2e_dir}/screenshots" ]]; then
    log_debug "Removing ${e2e_dir}/screenshots"
    rm -rf "${e2e_dir}/screenshots"
  fi
  
  if [[ -d "${e2e_dir}/playwright-report" ]]; then
    log_debug "Removing ${e2e_dir}/playwright-report"
    rm -rf "${e2e_dir}/playwright-report"
  fi
  
  if [[ -f "${e2e_dir}/${JUNIT_RESULTS}" ]]; then
    log_debug "Removing ${e2e_dir}/${JUNIT_RESULTS}"
    rm -f "${e2e_dir}/${JUNIT_RESULTS}"
  fi
  
  log_success "Test artifacts cleaned up"
}

# Clean up Helm releases
# Usage: cleanup_helm_releases
cleanup_helm_releases() {
  log_section "Cleaning Up Helm Releases"
  
  local releases=(
    "${RELEASE_NAME}:${NAME_SPACE}"
    "${RELEASE_NAME_RBAC}:${NAME_SPACE_RBAC}"
  )
  
  for release_info in "${releases[@]}"; do
    local release_name="${release_info%%:*}"
    local namespace="${release_info##*:}"
    
    if helm list -n "${namespace}" 2>/dev/null | grep -q "${release_name}"; then
      log_info "Uninstalling Helm release: ${release_name} from ${namespace}"
      helm uninstall "${release_name}" -n "${namespace}" || log_warning "Failed to uninstall ${release_name}"
    else
      log_debug "Helm release ${release_name} not found in ${namespace}"
    fi
  done
  
  log_success "Helm releases cleaned up"
}

# ============================================================================
# Main Cleanup Workflow
# ============================================================================

main() {
  log_section "RHDH CI/CD Pipeline Cleanup"
  
  # Parse arguments
  local keep_artifacts=false
  local skip_namespaces=false
  
  while [[ $# -gt 0 ]]; do
    case $1 in
      --keep-artifacts)
        keep_artifacts=true
        shift
        ;;
      --skip-namespaces)
        skip_namespaces=true
        shift
        ;;
      --help)
        echo "Usage: cleanup.sh [OPTIONS]"
        echo ""
        echo "Options:"
        echo "  --keep-artifacts    Keep test artifacts (don't delete)"
        echo "  --skip-namespaces   Skip namespace cleanup"
        echo "  --help              Show this help message"
        exit 0
        ;;
      *)
        log_error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
    esac
  done
  
  # Login to cluster if needed
  if [[ "${skip_namespaces}" == "false" ]]; then
    if ! oc whoami &> /dev/null; then
      log_info "Not logged in to OpenShift. Attempting login..."
      oc_login || {
        log_warning "Failed to login to OpenShift. Skipping namespace cleanup"
        skip_namespaces=true
      }
    fi
  fi
  
  # Perform cleanup steps
  cleanup_temp_files
  cleanup_test_artifacts "${keep_artifacts}"
  
  if [[ "${skip_namespaces}" == "false" ]]; then
    cleanup_helm_releases
    cleanup_all_test_namespaces
  fi
  
  log_section "Cleanup Complete"
  log_success "All cleanup operations completed successfully"
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi



