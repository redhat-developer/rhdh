#!/bin/bash
# Test reporting and artifact management for RHDH CI/CD Pipeline

# Prevent double sourcing
if [[ -n "${__CORE_REPORTING_SH_LOADED__:-}" ]]; then
  return 0
fi
export __CORE_REPORTING_SH_LOADED__=1

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# ============================================================================
# Reporting Variables
# ============================================================================
# Counter for tracking multiple deployments
export CURRENT_DEPLOYMENT=0

# Arrays for deployment tracking (compatible with bash 3.2+)
# Using indexed arrays instead of associative arrays for macOS compatibility
STATUS_DEPLOYMENT_NAMESPACE=()      # Namespace for each deployment
STATUS_FAILED_TO_DEPLOY=()          # Whether deployment failed (true/false)
STATUS_TEST_FAILED=()               # Whether tests failed (true/false)
STATUS_NUMBER_OF_TEST_FAILED=()     # Number of failed tests

# Overall result of the test run (0 = success, 1 = failure)
export OVERALL_RESULT=0

# ============================================================================
# Reporting Directory Setup
# ============================================================================
# Ensure reporting directory exists (only if ARTIFACT_DIR is set and accessible)
if [[ -n "${ARTIFACT_DIR}" && -w "${ARTIFACT_DIR%/*}" ]]; then
  mkdir -p "${ARTIFACT_DIR}/reporting"
fi

# ============================================================================
# Status Tracking Functions
# ============================================================================

# Save the namespace for a deployment
# Usage: save_status_deployment_namespace <deployment_id> <namespace>
save_status_deployment_namespace() {
  local current_deployment=$1
  local current_namespace=$2
  
  log_debug "Saving STATUS_DEPLOYMENT_NAMESPACE[${current_deployment}]=${current_namespace}"
  
  STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]="${current_namespace}"
  printf "%s\n" "${STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]}" \
    >> "${SHARED_DIR}/STATUS_DEPLOYMENT_NAMESPACE.txt"
  cp "${SHARED_DIR}/STATUS_DEPLOYMENT_NAMESPACE.txt" \
    "${ARTIFACT_DIR}/reporting/STATUS_DEPLOYMENT_NAMESPACE.txt"
}

# Save deployment failure status
# Usage: save_status_failed_to_deploy <deployment_id> <true|false>
save_status_failed_to_deploy() {
  local current_deployment=$1
  local status=$2
  
  log_debug "Saving STATUS_FAILED_TO_DEPLOY[${current_deployment}]=${status}"
  
  STATUS_FAILED_TO_DEPLOY["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_FAILED_TO_DEPLOY["${current_deployment}"]}" \
    >> "${SHARED_DIR}/STATUS_FAILED_TO_DEPLOY.txt"
  cp "${SHARED_DIR}/STATUS_FAILED_TO_DEPLOY.txt" \
    "${ARTIFACT_DIR}/reporting/STATUS_FAILED_TO_DEPLOY.txt"
}

# Save test failure status
# Usage: save_status_test_failed <deployment_id> <true|false>
save_status_test_failed() {
  local current_deployment=$1
  local status=$2
  
  log_debug "Saving STATUS_TEST_FAILED[${current_deployment}]=${status}"
  
  STATUS_TEST_FAILED["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_TEST_FAILED["${current_deployment}"]}" \
    >> "${SHARED_DIR}/STATUS_TEST_FAILED.txt"
  cp "${SHARED_DIR}/STATUS_TEST_FAILED.txt" \
    "${ARTIFACT_DIR}/reporting/STATUS_TEST_FAILED.txt"
}

# Save the number of failed tests
# Usage: save_status_number_of_test_failed <deployment_id> <number>
save_status_number_of_test_failed() {
  local current_deployment=$1
  local number=$2
  
  log_debug "Saving STATUS_NUMBER_OF_TEST_FAILED[${current_deployment}]=${number}"
  
  STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]="${number}"
  printf "%s\n" "${STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]}" \
    >> "${SHARED_DIR}/STATUS_NUMBER_OF_TEST_FAILED.txt"
  cp "${SHARED_DIR}/STATUS_NUMBER_OF_TEST_FAILED.txt" \
    "${ARTIFACT_DIR}/reporting/STATUS_NUMBER_OF_TEST_FAILED.txt"
}

# Save the overall result of the test run
# Usage: save_overall_result <0|1>
save_overall_result() {
  local result=$1
  OVERALL_RESULT=${result}
  
  log_info "Saving OVERALL_RESULT=${OVERALL_RESULT}"
  
  printf "%s" "${OVERALL_RESULT}" > "${SHARED_DIR}/OVERALL_RESULT.txt"
  cp "${SHARED_DIR}/OVERALL_RESULT.txt" \
    "${ARTIFACT_DIR}/reporting/OVERALL_RESULT.txt"
}

# Save OpenShift detection status
# Usage: save_is_openshift <true|false>
save_is_openshift() {
  local is_openshift=$1
  
  log_debug "Saving IS_OPENSHIFT=${is_openshift}"
  
  printf "%s" "${is_openshift}" > "${SHARED_DIR}/IS_OPENSHIFT.txt"
  cp "${SHARED_DIR}/IS_OPENSHIFT.txt" \
    "${ARTIFACT_DIR}/reporting/IS_OPENSHIFT.txt"
}

# Save container platform information
# Usage: save_container_platform <platform> <version>
save_container_platform() {
  local container_platform=$1
  local container_platform_version=$2
  
  log_debug "Saving CONTAINER_PLATFORM=${container_platform}"
  log_debug "Saving CONTAINER_PLATFORM_VERSION=${container_platform_version}"
  
  printf "%s" "${container_platform}" > "${SHARED_DIR}/CONTAINER_PLATFORM.txt"
  printf "%s" "${container_platform_version}" > "${SHARED_DIR}/CONTAINER_PLATFORM_VERSION.txt"
  cp "${SHARED_DIR}/CONTAINER_PLATFORM.txt" \
    "${ARTIFACT_DIR}/reporting/CONTAINER_PLATFORM.txt"
  cp "${SHARED_DIR}/CONTAINER_PLATFORM_VERSION.txt" \
    "${ARTIFACT_DIR}/reporting/CONTAINER_PLATFORM_VERSION.txt"
}

# ============================================================================
# Artifact URL Generation
# ============================================================================

# Generate URL to artifacts in OpenShift CI storage
# Usage: get_artifacts_url [namespace]
get_artifacts_url() {
  local namespace=$1
  
  if [[ -z "${namespace}" ]]; then
    log_warning "Namespace parameter is empty (expected only for top-level artifacts)"
  fi
  
  local artifacts_base_url="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results"
  local artifacts_complete_url
  
  if [[ -n "${PULL_NUMBER:-}" ]]; then
    # Pull request job URL structure
    local part_1="${JOB_NAME##pull-ci-redhat-developer-rhdh-main-}"
    local suite_name="${JOB_NAME##pull-ci-redhat-developer-rhdh-main-e2e-}"
    local part_2="redhat-developer-rhdh-${suite_name}"
    
    # Special cases for naming conventions
    case "${JOB_NAME}" in
      *osd-gcp*)
        part_2="redhat-developer-rhdh-osd-gcp-helm-nightly"
        ;;
      *ocp-v*helm*-nightly*)
        part_2="redhat-developer-rhdh-ocp-helm-nightly"
        ;;
    esac
    
    artifacts_complete_url="${artifacts_base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}/artifacts/${part_1}/${part_2}/artifacts/${namespace}"
  else
    # Periodic/nightly job URL structure
    local part_1="${JOB_NAME##periodic-ci-redhat-developer-rhdh-${RELEASE_BRANCH_NAME}-}"
    local suite_name="${JOB_NAME##periodic-ci-redhat-developer-rhdh-${RELEASE_BRANCH_NAME}-e2e-}"
    local part_2="redhat-developer-rhdh-${suite_name}"
    
    # Special cases for naming conventions
    case "${JOB_NAME}" in
      *osd-gcp*)
        part_2="redhat-developer-rhdh-osd-gcp-helm-nightly"
        ;;
      *ocp-v*helm*-nightly*)
        part_2="redhat-developer-rhdh-ocp-helm-nightly"
        ;;
    esac
    
    artifacts_complete_url="${artifacts_base_url}/logs/${JOB_NAME}/${BUILD_ID}/artifacts/${part_1}/${part_2}/artifacts/${namespace}"
  fi
  
  echo "${artifacts_complete_url}"
}

# Generate URL to job in OpenShift CI Prow
# Usage: get_job_url
get_job_url() {
  local job_base_url="https://prow.ci.openshift.org/view/gs/test-platform-results"
  local job_complete_url
  
  if [[ -n "${PULL_NUMBER:-}" ]]; then
    job_complete_url="${job_base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}"
  else
    job_complete_url="${job_base_url}/logs/${JOB_NAME}/${BUILD_ID}"
  fi
  
  echo "${job_complete_url}"
}

# ============================================================================
# JUnit Results Processing
# ============================================================================

# Save and process JUnit results for Data Router
# Usage: save_data_router_junit_results <namespace>
save_data_router_junit_results() {
  # Skip if not running in OpenShift CI
  if [[ "${OPENSHIFT_CI}" != "true" ]]; then
    log_debug "Skipping Data Router JUnit processing (not in OpenShift CI)"
    return 0
  fi
  
  local namespace=$1
  
  if [[ -z "${namespace}" ]]; then
    log_error "Namespace parameter is required for JUnit processing"
    return 1
  fi
  
  local junit_file="${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}"
  
  if [[ ! -f "${junit_file}" ]]; then
    log_warning "JUnit results file not found: ${junit_file}"
    return 1
  fi
  
  log_info "Processing JUnit results for namespace: ${namespace}"
  
  # Get artifacts URL for this namespace
  local artifacts_url=$(get_artifacts_url "${namespace}")
  
  # Save original file
  cp "${junit_file}" "${junit_file}.original.xml"
  
  # Replace attachment placeholders with actual URLs to OpenShift CI storage
  sed -i "s#\[\[ATTACHMENT|\(.*\)\]\]#${artifacts_url}/\1#g" "${junit_file}"
  
  # Convert XML property tags to self-closing format
  # Step 1: Remove all closing property tags
  sed -i 's#</property>##g' "${junit_file}"
  # Step 2: Convert opening property tags to self-closing format
  sed -i 's#<property name="\([^"]*\)" value="\([^"]*\)">#<property name="\1" value="\2"/>#g' "${junit_file}"
  
  # Copy results to shared directory for Data Router consumption
  cp "${junit_file}" "${SHARED_DIR}/junit-results-${namespace}.xml"
  
  log_success "JUnit results for ${namespace} processed and saved"
  log_debug "Artifacts URL: ${artifacts_url}"
  log_debug "Shared directory contents:"
  ls -la "${SHARED_DIR}" | while read -r line; do log_debug "  ${line}"; done
}

# ============================================================================
# Summary Report Generation
# ============================================================================

# Generate a summary report of all deployments and test results
# Usage: generate_summary_report
generate_summary_report() {
  local report_file="${ARTIFACT_DIR}/reporting/summary.txt"
  
  {
    echo "============================================================"
    echo "RHDH CI/CD Pipeline Summary Report"
    echo "============================================================"
    echo ""
    echo "Job Information:"
    echo "  Job Name: ${JOB_NAME}"
    echo "  Build ID: ${BUILD_ID}"
    echo "  Pull Number: ${PULL_NUMBER:-N/A}"
    echo "  Tag Name: ${TAG_NAME}"
    echo ""
    echo "Platform Information:"
    echo "  Is OpenShift: ${IS_OPENSHIFT}"
    echo "  Container Platform: ${CONTAINER_PLATFORM}"
    echo "  Platform Version: ${CONTAINER_PLATFORM_VERSION}"
    echo ""
    echo "Deployment Results:"
    echo "  Total Deployments: ${CURRENT_DEPLOYMENT}"
    echo ""
    
    # Iterate through all deployments
    for ((i = 1; i <= CURRENT_DEPLOYMENT; i++)); do
      echo "  Deployment ${i}:"
      echo "    Namespace: ${STATUS_DEPLOYMENT_NAMESPACE[$i]:-unknown}"
      echo "    Deployment Failed: ${STATUS_FAILED_TO_DEPLOY[$i]:-unknown}"
      echo "    Tests Failed: ${STATUS_TEST_FAILED[$i]:-unknown}"
      echo "    Number of Failed Tests: ${STATUS_NUMBER_OF_TEST_FAILED[$i]:-unknown}"
      echo ""
    done
    
    echo "Overall Result: ${OVERALL_RESULT}"
    echo ""
    
    if [[ "${OVERALL_RESULT}" -eq 0 ]]; then
      echo "Status: ✅ SUCCESS"
    else
      echo "Status: ❌ FAILURE"
    fi
    
    echo ""
    echo "Artifacts URL: $(get_artifacts_url '')"
    echo "Job URL: $(get_job_url)"
    echo ""
    echo "============================================================"
  } > "${report_file}"
  
  # Print summary to console
  cat "${report_file}"
  
  log_success "Summary report generated: ${report_file}"
}

# ============================================================================
# Export Functions
# ============================================================================
export -f save_status_deployment_namespace
export -f save_status_failed_to_deploy
export -f save_status_test_failed
export -f save_status_number_of_test_failed
export -f save_overall_result
export -f save_is_openshift
export -f save_container_platform
export -f get_artifacts_url
export -f get_job_url
export -f save_data_router_junit_results
export -f generate_summary_report

