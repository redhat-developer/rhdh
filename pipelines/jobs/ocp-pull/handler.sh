#!/bin/bash
# OCP Pull job handler - Main orchestration for OpenShift Pull Request testing

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source required modules
# shellcheck source=../../modules/platform/ocp.sh
source "${PIPELINES_ROOT}/modules/platform/ocp.sh"
# shellcheck source=../../modules/deployment/helm.sh
source "${PIPELINES_ROOT}/modules/deployment/helm.sh"
# shellcheck source=../../modules/testing/playwright.sh
source "${PIPELINES_ROOT}/modules/testing/playwright.sh"
# shellcheck source=./config.sh
source "${PIPELINES_ROOT}/jobs/ocp-pull/config.sh"

# ============================================================================
# Main Job Handler
# ============================================================================

# Handle OCP Pull Request testing job
# This is the main entry point for the OCP Pull job
handle_ocp_pull() {
  log_section "Starting OCP Pull Request Testing Job"
  
  # Display job information
  log_info "Job Name: ${JOB_NAME}"
  log_info "Pull Number: ${PULL_NUMBER}"
  log_info "Build ID: ${BUILD_ID}"
  log_info "Tag Name: ${TAG_NAME}"
  log_info "Chart Version: ${CHART_VERSION}"
  
  # Step 1: Login to OpenShift cluster
  log_step 1 "Logging into OpenShift cluster"
  oc_login
  
  # Display OCP version
  log_info "OpenShift version: $(oc version)"
  
  # Step 2: Detect cluster router base
  log_step 2 "Detecting cluster router base"
  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console \
    -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  log_info "Cluster Router Base: ${K8S_CLUSTER_ROUTER_BASE}"
  
  # Step 3: Detect and save platform information
  log_step 3 "Detecting platform and container information"
  detect_ocp
  detect_container_platform
  
  # Step 4: Setup OpenShift cluster for Helm deployments
  log_step 4 "Setting up OpenShift cluster"
  cluster_setup_ocp_helm
  
  # Step 5: Deploy RHDH instances (base and RBAC)
  log_step 5 "Initiating RHDH deployments"
  initiate_deployments
  
  # Step 6: Deploy test customization provider
  log_step 6 "Deploying test backstage customization provider"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  
  # Step 7: Test base deployment
  log_step 7 "Testing base RHDH deployment"
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  log_info "Base deployment URL: ${url}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  
  # Step 8: Test RBAC deployment
  log_step 8 "Testing RBAC RHDH deployment"
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  log_info "RBAC deployment URL: ${rbac_url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
  
  # Step 9: Print test summary
  log_step 9 "Generating test summary"
  print_test_summary
  generate_summary_report
  
  # Step 10: Determine final result
  log_section "Job Completed"
  if [[ ${OVERALL_RESULT} -eq 0 ]]; then
    log_success "OCP Pull job completed successfully! ✅"
  else
    log_error "OCP Pull job completed with failures ❌"
  fi
  
  log_info "Artifacts available at: $(get_artifacts_url '')"
  log_info "Job URL: $(get_job_url)"
  
  return ${OVERALL_RESULT}
}

# ============================================================================
# Export Functions
# ============================================================================
export -f handle_ocp_pull

