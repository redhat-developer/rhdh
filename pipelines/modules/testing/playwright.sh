#!/bin/bash
# Playwright testing functions for RHDH CI/CD Pipeline

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source core modules
# shellcheck source=../../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"
# shellcheck source=../../core/reporting.sh
source "${PIPELINES_ROOT}/core/reporting.sh"

# ============================================================================
# Backstage Health Check
# ============================================================================

# Check if Backstage is up and running
# Usage: check_backstage_running <release_name> <namespace> <url> [max_attempts] [wait_seconds]
check_backstage_running() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30}
  local wait_seconds=${5:-30}
  
  if [[ -z "${url}" ]]; then
    log_error "URL is not set. Please provide a valid URL"
    return 1
  fi
  
  log_info "Checking if Backstage is up and running at ${url}"
  log_debug "Max attempts: ${max_attempts}, Wait: ${wait_seconds}s"
  
  for ((i = 1; i <= max_attempts; i++)); do
    # Check HTTP status
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}")
    
    # Accept 200 (OK), 301/302 (redirects), and 304 (not modified) as success
    if [[ "${http_status}" -eq 200 || "${http_status}" -eq 301 || "${http_status}" -eq 302 || "${http_status}" -eq 304 ]]; then
      log_success "Backstage is up and running! (HTTP Status: ${http_status})"
      export BASE_URL="${url}"
      log_info "BASE_URL: ${BASE_URL}"
      return 0
    elif [[ "${http_status}" == "000" ]]; then
      log_warn "Attempt ${i} of ${max_attempts}: Cannot connect to ${url} (DNS/Network issue)"
      if [[ $i -ge 5 ]]; then
        log_error "Persistent connection failure after 5 attempts. Check DNS and network connectivity."
      fi
      if [[ $((i % 5)) -eq 0 ]]; then
        log_info "Current pods status:"
        oc get pods -n "${namespace}"
      fi
      sleep "${wait_seconds}"
    else
      log_debug "Attempt ${i} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
      if [[ $((i % 5)) -eq 0 ]]; then
        log_info "Current pods status:"
        oc get pods -n "${namespace}"
      fi
      sleep "${wait_seconds}"
    fi
  done
  
  log_error "Failed to reach Backstage at ${url} after ${max_attempts} attempts"
  log_info "Last events in namespace:"
  oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -10
  
  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/" 2>/dev/null || true
  save_all_pod_logs "${namespace}"
  
  return 1
}

# ============================================================================
# Test Execution
# ============================================================================

# Run Playwright tests
# Usage: run_tests <release_name> <project_name>
run_tests() {
  local release_name=$1
  local project=$2
  
  log_section "Running Playwright Tests for ${project}"
  
  # Navigate to e2e-tests directory
  cd "${PROJECT_ROOT}/e2e-tests"
  local e2e_tests_dir=$(pwd)
  
  log_info "E2E tests directory: ${e2e_tests_dir}"
  
  # Install dependencies
  log_info "Installing yarn dependencies"
  yarn install --immutable > /tmp/yarn.install.log.txt 2>&1
  
  local install_status=$?
  if [[ ${install_status} -ne 0 ]]; then
    log_error "Yarn install failed!"
    cat /tmp/yarn.install.log.txt
    exit ${install_status}
  else
    log_success "Yarn install completed successfully"
  fi
  
  # Install Playwright browsers
  log_info "Installing Playwright chromium browser"
  yarn playwright install chromium
  
  # Start virtual display for headless browser testing
  log_info "Starting Xvfb virtual display"
  Xvfb :99 &
  export DISPLAY=:99
  
  # Run tests and capture output
  log_info "Running tests with tag: ${TAG_NAME}"
  log_info "Executing: yarn ${project}"
  
  (
    set -e
    echo "Using PR container image: ${TAG_NAME}"
    yarn "${project}"
  ) 2>&1 | tee "/tmp/${LOGFILE}"
  
  local result=${PIPESTATUS[0]}
  
  # Kill Xvfb
  pkill Xvfb || true
  
  # Collect test artifacts
  log_info "Collecting test artifacts"
  mkdir -p "${ARTIFACT_DIR}/${project}/test-results"
  mkdir -p "${ARTIFACT_DIR}/${project}/attachments/screenshots"
  
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${project}/test-results" 2>/dev/null || true
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}" 2>/dev/null || true
  cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${project}/attachments/screenshots/" 2>/dev/null || true
  
  # Convert log to HTML
  if command -v ansi2html &> /dev/null; then
    ansi2html < "/tmp/${LOGFILE}" > "/tmp/${LOGFILE}.html"
    cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${project}" 2>/dev/null || true
  fi
  
  # Copy Playwright report
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${project}" 2>/dev/null || true
  
  # Save JUnit results for Data Router
  save_data_router_junit_results "${project}"
  
  # Process test results
  log_info "${project} test execution completed with result: ${result}"
  
  if [[ ${result} -ne 0 ]]; then
    log_error "Tests failed for ${project}"
    save_overall_result 1
    save_status_test_failed ${CURRENT_DEPLOYMENT} true
  else
    log_success "Tests passed for ${project}"
    save_status_test_failed ${CURRENT_DEPLOYMENT} false
  fi
  
  # Extract failed test count from JUnit results
  if [[ -f "${e2e_tests_dir}/${JUNIT_RESULTS}" ]]; then
    local failed_tests=$(grep -oP 'failures="\K[0-9]+' "${e2e_tests_dir}/${JUNIT_RESULTS}" | head -n 1)
    log_info "Number of failed tests: ${failed_tests}"
    save_status_number_of_test_failed ${CURRENT_DEPLOYMENT} "${failed_tests}"
  else
    log_warning "JUnit results file not found: ${e2e_tests_dir}/${JUNIT_RESULTS}"
    local failed_tests="unknown"
    save_status_number_of_test_failed ${CURRENT_DEPLOYMENT} "${failed_tests}"
  fi
  
  return ${result}
}

# ============================================================================
# Complete Test Workflow
# ============================================================================

# Check Backstage health and run tests
# Usage: check_and_test <release_name> <namespace> <url> [max_attempts] [wait_seconds]
check_and_test() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30}
  local wait_seconds=${5:-30}
  
  log_section "Checking and Testing: ${namespace}"
  
  # Increment deployment counter
  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace ${CURRENT_DEPLOYMENT} "${namespace}"
  
  # Check if Backstage is running
  if check_backstage_running "${release_name}" "${namespace}" "${url}" "${max_attempts}" "${wait_seconds}"; then
    save_status_failed_to_deploy ${CURRENT_DEPLOYMENT} false
    
    log_info "Backstage is running. Displaying pods for verification:"
    oc get pods -n "${namespace}"
    
    # Run tests
    run_tests "${release_name}" "${namespace}"
  else
    log_error "Backstage is not running. Skipping tests"
    save_status_failed_to_deploy ${CURRENT_DEPLOYMENT} true
    save_status_test_failed ${CURRENT_DEPLOYMENT} true
    save_overall_result 1
  fi
  
  # Save pod logs regardless of test outcome
  save_all_pod_logs "${namespace}"
}

# ============================================================================
# Test Environment Setup
# ============================================================================

# Setup test environment variables
# Usage: setup_test_environment
setup_test_environment() {
  log_info "Setting up test environment"
  
  # Ensure test directories exist
  mkdir -p "${ARTIFACT_DIR}"
  mkdir -p "${PROJECT_ROOT}/e2e-tests/test-results"
  mkdir -p "${PROJECT_ROOT}/e2e-tests/screenshots"
  
  # Set Playwright environment variables
  export PWDEBUG="${PWDEBUG:-0}"
  export HEADED="${HEADED:-false}"
  
  # Set test timeout
  export TEST_TIMEOUT="${TEST_TIMEOUT:-90000}"
  
  log_success "Test environment setup completed"
}

# Cleanup test environment
# Usage: cleanup_test_environment
cleanup_test_environment() {
  log_info "Cleaning up test environment"
  
  # Kill any remaining Xvfb processes
  pkill Xvfb 2>/dev/null || true
  
  # Clean up temporary test files
  rm -f /tmp/yarn.install.log.txt
  
  log_success "Test environment cleanup completed"
}

# ============================================================================
# Test Result Summary
# ============================================================================

# Print test results summary
# Usage: print_test_summary
print_test_summary() {
  log_section "Test Results Summary"
  
  local total_deployments=${CURRENT_DEPLOYMENT}
  local failed_deployments=0
  local failed_tests=0
  
  for ((i = 1; i <= total_deployments; i++)); do
    local namespace="${STATUS_DEPLOYMENT_NAMESPACE[$i]:-unknown}"
    local deploy_failed="${STATUS_FAILED_TO_DEPLOY[$i]:-unknown}"
    local test_failed="${STATUS_TEST_FAILED[$i]:-unknown}"
    local num_failed="${STATUS_NUMBER_OF_TEST_FAILED[$i]:-unknown}"
    
    log_info "Deployment $i (${namespace}):"
    log_info "  Deployment Failed: ${deploy_failed}"
    log_info "  Tests Failed: ${test_failed}"
    log_info "  Number of Failed Tests: ${num_failed}"
    
    if [[ "${deploy_failed}" == "true" ]]; then
      ((failed_deployments++))
    fi
    
    if [[ "${test_failed}" == "true" ]]; then
      ((failed_tests++))
    fi
  done
  
  log_info "Total Deployments: ${total_deployments}"
  log_info "Failed Deployments: ${failed_deployments}"
  log_info "Deployments with Failed Tests: ${failed_tests}"
  
  if [[ ${OVERALL_RESULT} -eq 0 ]]; then
    log_success "Overall Result: SUCCESS"
  else
    log_error "Overall Result: FAILURE"
  fi
}

# ============================================================================
# Export Functions
# ============================================================================
export -f check_backstage_running
export -f run_tests
export -f check_and_test
export -f setup_test_environment
export -f cleanup_test_environment
export -f print_test_summary

