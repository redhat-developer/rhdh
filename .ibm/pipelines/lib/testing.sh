#!/usr/bin/env bash

# Testing utilities for CI pipelines
# Handles Playwright test execution, Backstage health checks, and upgrade verification
# Dependencies: oc, kubectl, yarn, playwright, lib/log.sh

# Prevent re-sourcing
if [[ -n "${TESTING_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly TESTING_LIB_SOURCED=1

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# ==============================================================================
# Constants
# ==============================================================================

readonly _TESTING_ERR_MISSING_PARAMS="Missing required parameters"

# ==============================================================================
# Test Execution
# ==============================================================================

# Run Playwright tests against a Backstage deployment
# Args:
#   $1 - release_name: The Helm release name
#   $2 - namespace: The namespace where Backstage is deployed
#   $3 - playwright_project: The Playwright project to run
#   $4 - url: (optional) The URL to test against
# Returns:
#   0 - Tests passed
#   Non-zero - Tests failed
# Uses globals: CURRENT_DEPLOYMENT, DIR, TAG_NAME, ARTIFACT_DIR, LOGFILE, JUNIT_RESULTS, CI, SHARED_DIR
testing::run_tests() {
  local release_name=$1
  local namespace=$2
  local playwright_project=$3
  local url="${4:-}"

  if [[ -z "$release_name" || -z "$namespace" || -z "$playwright_project" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::run_tests <release_name> <namespace> <playwright_project> [url]"
    return 1
  fi

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"
  save_status_failed_to_deploy $CURRENT_DEPLOYMENT false

  BASE_URL="${url}"
  export BASE_URL
  log::info "BASE_URL: ${BASE_URL}"
  log::info "Running Playwright project '${playwright_project}' against namespace '${namespace}'"

  cd "${DIR}/../../e2e-tests" || return 1
  local e2e_tests_dir
  e2e_tests_dir=$(pwd)

  yarn install --immutable > /tmp/yarn.install.log.txt 2>&1
  local install_status=$?
  if [[ $install_status -ne 0 ]]; then
    log::error "=== YARN INSTALL FAILED ==="
    cat /tmp/yarn.install.log.txt
    exit $install_status
  else
    log::success "Yarn install completed successfully."
  fi

  yarn playwright install chromium

  Xvfb :99 &
  export DISPLAY=:99

  (
    set -e
    log::info "Using PR container image: ${TAG_NAME}"
    yarn playwright test --project="${playwright_project}"
  ) 2>&1 | tee "/tmp/${LOGFILE}"

  local test_result=${PIPESTATUS[0]}

  pkill Xvfb || true

  # Use namespace for artifact directory to keep artifacts organized by deployment
  mkdir -p "${ARTIFACT_DIR}/${namespace}/test-results"
  mkdir -p "${ARTIFACT_DIR}/${namespace}/attachments/screenshots"
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${namespace}/test-results" || true
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" || true
  if [[ "${CI}" == "true" ]]; then
    cp "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" "${SHARED_DIR}/junit-results-${namespace}.xml" || true
  fi

  cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${namespace}/attachments/screenshots/" || true
  ansi2html < "/tmp/${LOGFILE}" > "/tmp/${LOGFILE}.html"
  cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${namespace}" || true
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${namespace}" || true

  echo "Playwright project '${playwright_project}' in namespace '${namespace}' RESULT: ${test_result}"
  if [[ "${test_result}" -ne 0 ]]; then
    save_overall_result 1
    save_status_test_failed $CURRENT_DEPLOYMENT true
  else
    save_status_test_failed $CURRENT_DEPLOYMENT false
  fi
  if [[ -f "${e2e_tests_dir}/${JUNIT_RESULTS}" ]]; then
    local failed_tests
    failed_tests=$(grep -oP 'failures="\K[0-9]+' "${e2e_tests_dir}/${JUNIT_RESULTS}" | head -n 1)
    echo "Number of failed tests: ${failed_tests}"
    save_status_number_of_test_failed $CURRENT_DEPLOYMENT "${failed_tests}"
  else
    echo "JUnit results file not found: ${e2e_tests_dir}/${JUNIT_RESULTS}"
    local failed_tests="some"
    echo "Number of failed tests unknown, saving as $failed_tests."
    save_status_number_of_test_failed $CURRENT_DEPLOYMENT "${failed_tests}"
  fi
  return 0
}

# ==============================================================================
# Health Checks
# ==============================================================================

# Check if Backstage is up and running at the given URL
# Args:
#   $1 - release_name: The Helm release name
#   $2 - namespace: The namespace where Backstage is deployed
#   $3 - url: The URL to check
#   $4 - max_attempts: (optional) Maximum number of attempts (default: 30)
#   $5 - wait_seconds: (optional) Seconds to wait between attempts (default: 30)
# Returns:
#   0 - Backstage is running
#   1 - Backstage is not running or crashed
testing::check_backstage_running() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30}
  local wait_seconds=${5:-30}

  if [[ -z "$release_name" || -z "$namespace" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::check_backstage_running <release_name> <namespace> <url> [max_attempts] [wait_seconds]"
    return 1
  fi

  if [[ -z "${url}" ]]; then
    log::error "Error: URL is not set. Please provide a valid URL."
    return 1
  fi

  log::info "Checking if Backstage is up and running at ${url}"

  for ((i = 1; i <= max_attempts; i++)); do
    # Check HTTP status
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}")

    if [[ "${http_status}" -eq 200 ]]; then
      log::success "Backstage is up and running!"
      return 0
    else
      log::warn "Attempt ${i} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
      oc get pods -n "${namespace}"

      # Early crash detection: fail fast if RHDH pods are in CrashLoopBackOff
      local crash_pods
      crash_pods=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/instance in (${release_name},redhat-developer-hub,developer-hub,${release_name}-postgresql)" \
        -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.phase}{" "}{range .status.containerStatuses[*]}{.state.waiting.reason}{end}{range .status.initContainerStatuses[*]}{.state.waiting.reason}{end}{"\n"}{end}' 2> /dev/null | grep -E "CrashLoopBackOff" || true)
      # Also check by name pattern for postgresql pods that may have different labels
      if [[ -z "${crash_pods}" ]]; then
        crash_pods=$(oc get pods -n "${namespace}" --no-headers 2> /dev/null | grep -E "(${release_name}|developer-hub|postgresql)" | grep -E "CrashLoopBackOff|Init:CrashLoopBackOff" || true)
      fi

      if [[ -n "${crash_pods}" ]]; then
        log::error "Detected pods in CrashLoopBackOff state - failing fast instead of waiting:"
        echo "${crash_pods}"
        log::error "Deployment status:"
        oc get deployment -l "app.kubernetes.io/instance in (${release_name},redhat-developer-hub,developer-hub)" -n "${namespace}" -o wide 2> /dev/null || true
        log::error "Recent logs from deployment:"
        oc logs deployment/${release_name}-developer-hub -n "${namespace}" --tail=100 --all-containers=true 2> /dev/null \
          || oc logs deployment/${release_name} -n "${namespace}" --tail=100 --all-containers=true 2> /dev/null || true
        log::error "Recent events:"
        oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -20
        mkdir -p "${ARTIFACT_DIR}/${namespace}"
        cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/" || true
        save_all_pod_logs "${namespace}"
        return 1
      fi

      sleep "${wait_seconds}"
    fi
  done

  log::error "Failed to reach Backstage at ${url} after ${max_attempts} attempts."
  oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -10
  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/" || true
  save_all_pod_logs "${namespace}"
  return 1
}

# ==============================================================================
# Combined Check and Test Functions
# ==============================================================================

# Check if Backstage is running and run tests if it is
# Args:
#   $1 - release_name: The Helm release name
#   $2 - namespace: The namespace where Backstage is deployed
#   $3 - playwright_project: The Playwright project to run
#   $4 - url: The URL to test against
#   $5 - max_attempts: (optional) Maximum number of attempts (default: 30)
#   $6 - wait_seconds: (optional) Seconds to wait between attempts (default: 30)
# Uses globals: CURRENT_DEPLOYMENT, SKIP_TESTS
testing::check_and_test() {
  local release_name=$1
  local namespace=$2
  local playwright_project=$3
  local url=$4
  local max_attempts=${5:-30}
  local wait_seconds=${6:-30}

  if [[ -z "$release_name" || -z "$namespace" || -z "$playwright_project" || -z "$url" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::check_and_test <release_name> <namespace> <playwright_project> <url> [max_attempts] [wait_seconds]"
    return 1
  fi

  if testing::check_backstage_running "${release_name}" "${namespace}" "${url}" "${max_attempts}" "${wait_seconds}"; then
    echo "Display pods for verification..."
    oc get pods -n "${namespace}"
    if [[ "${SKIP_TESTS:-false}" == "true" ]]; then
      log::info "SKIP_TESTS=true, skipping test execution for namespace: ${namespace}"
    else
      testing::run_tests "${release_name}" "${namespace}" "${playwright_project}" "${url}"
    fi
  else
    echo "Backstage is not running. Marking deployment as failed and continuing..."
    CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
    save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT true
    save_status_test_failed $CURRENT_DEPLOYMENT true
    save_overall_result 1
  fi
  save_all_pod_logs "$namespace"
  return 0
}

# ==============================================================================
# Upgrade Verification
# ==============================================================================

# Check Helm upgrade rollout status
# Args:
#   $1 - deployment_name: The name of the deployment
#   $2 - namespace: The namespace where the deployment is located
#   $3 - timeout: Timeout in seconds (default: 600)
# Returns:
#   0 - Upgrade completed successfully
#   1 - Upgrade failed or timed out
testing::check_helm_upgrade() {
  local deployment_name="$1"
  local namespace="$2"
  local timeout="${3:-600}"

  if [[ -z "$deployment_name" || -z "$namespace" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::check_helm_upgrade <deployment_name> <namespace> [timeout]"
    return 1
  fi

  log::info "Checking rollout status for deployment: ${deployment_name} in namespace: ${namespace}..."

  if oc rollout status "deployment/${deployment_name}" -n "${namespace}" --timeout="${timeout}s" -w; then
    log::info "RHDH upgrade is complete."
    return 0
  else
    log::error "RHDH upgrade encountered an issue or timed out."
    return 1
  fi
}

# Check upgrade and run tests if successful
# Args:
#   $1 - deployment_name: The name of the deployment
#   $2 - release_name: The Helm release name
#   $3 - namespace: The namespace
#   $4 - playwright_project: The Playwright project to run
#   $5 - url: The URL to test against
#   $6 - timeout: (optional) Timeout in seconds (default: 600)
# Uses globals: CURRENT_DEPLOYMENT
testing::check_upgrade_and_test() {
  local deployment_name="$1"
  local release_name="$2"
  local namespace="$3"
  local playwright_project="$4"
  local url=$5
  local timeout=${6:-600}

  if [[ -z "$deployment_name" || -z "$release_name" || -z "$namespace" || -z "$playwright_project" || -z "$url" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::check_upgrade_and_test <deployment_name> <release_name> <namespace> <playwright_project> <url> [timeout]"
    return 1
  fi

  if testing::check_helm_upgrade "${deployment_name}" "${namespace}" "${timeout}"; then
    testing::check_and_test "${release_name}" "${namespace}" "${playwright_project}" "${url}"
  else
    log::error "Helm upgrade encountered an issue or timed out. Exiting..."
    CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
    save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT true
    save_status_test_failed $CURRENT_DEPLOYMENT true
    save_overall_result 1
  fi
  return 0
}
