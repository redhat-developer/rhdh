#!/usr/bin/env bash

# Testing utilities for CI pipelines
# Handles Playwright test execution, Backstage health checks, and upgrade verification
# Dependencies: oc, kubectl, yarn, playwright, lib/log.sh

# Prevent re-sourcing
if [[ -n "${TESTING_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly TESTING_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ci/pipelines/lib/test-run-tracker.sh
source "${DIR}/lib/test-run-tracker.sh"

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
#   $5 - artifacts_subdir: (optional) Subdirectory for artifacts (defaults to playwright_project)
# Returns:
#   0 - Tests passed
#   Non-zero - Tests failed
# Uses globals: DIR, TAG_NAME, ARTIFACT_DIR, LOGFILE, JUNIT_RESULTS, CI, SHARED_DIR
testing::run_tests() {
  local release_name=$1
  local namespace=$2
  local playwright_project=$3
  local url="${4:-}"
  local artifacts_subdir="${5:-$playwright_project}"

  if [[ -z "$release_name" || -z "$namespace" || -z "$playwright_project" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::run_tests <release_name> <namespace> <playwright_project> [url] [artifacts_subdir]"
    return 1
  fi

  test_run_tracker::register "$artifacts_subdir"
  test_run_tracker::mark_deploy_success

  # Pessimistic default: assume tests failed until Playwright proves otherwise.
  # If the job is killed (Prow timeout) or Playwright hangs, the STATUS files
  # still have entries for all registered test runs — preventing misaligned
  # arrays that break downstream reporting (Slack notifications).
  test_run_tracker::mark_test_result "false" "${UNKNOWN_FAILURE_COUNT}"

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

  # RHIDP-13243: V8 coverage collection for E2E tests (opt-in).
  # Set COLLECT_COVERAGE=true in the job config to enable. When enabled, the
  # coverage fixture wraps page.coverage.startJSCoverage/stopJSCoverage and
  # the reporter merges raw JSON into lcov via monocart-coverage-reports.
  export COLLECT_COVERAGE="${COLLECT_COVERAGE:-false}"

  # Remove stale coverage artifacts so a previous project's lcov.info
  # is never mistakenly uploaded for the current run.
  rm -rf "${e2e_tests_dir}/coverage/e2e" "${e2e_tests_dir}/coverage/e2e-raw"

  # Optional tag filter: set PLAYWRIGHT_GREP (e.g. '@smoke' or '@layer3-equivalent')
  # to run only the matching subset. Unset means run the whole project.
  local grep_args=()
  if [[ -n "${PLAYWRIGHT_GREP:-}" ]]; then
    grep_args+=(--grep "${PLAYWRIGHT_GREP}")
    log::info "Filtering tests by tag: ${PLAYWRIGHT_GREP}"
  fi

  (
    set -e
    log::info "Using PR container image: ${TAG_NAME}"
    yarn playwright test --project="${playwright_project}" ${grep_args[@]+"${grep_args[@]}"}
  ) 2>&1 | tee "/tmp/${LOGFILE}"

  local test_result=${PIPESTATUS[0]}

  pkill Xvfb || true

  # Use artifacts_subdir for artifact directory to keep artifacts organized
  common::save_artifact "${artifacts_subdir}" "${e2e_tests_dir}/test-results/" "test-results" || true
  common::save_artifact "${artifacts_subdir}" "${e2e_tests_dir}/${JUNIT_RESULTS}" || true
  testing::_publish_junit_to_shared_dir "${artifacts_subdir}" "${ARTIFACT_DIR}/${artifacts_subdir}/${JUNIT_RESULTS}"

  common::save_artifact "${artifacts_subdir}" "${e2e_tests_dir}/screenshots/" "attachments/screenshots" || true
  ansi2html < "/tmp/${LOGFILE}" > "/tmp/${LOGFILE}.html"
  common::save_artifact "${artifacts_subdir}" "/tmp/${LOGFILE}.html" || true
  common::save_artifact "${artifacts_subdir}" "${e2e_tests_dir}/playwright-report/" || true

  # RHIDP-13243: Save and upload E2E coverage report
  if [[ -f "${e2e_tests_dir}/coverage/e2e/lcov.info" ]]; then
    common::save_artifact "${artifacts_subdir}" "${e2e_tests_dir}/coverage/e2e/" "coverage" || true
    if [[ -n "${CODECOV_TOKEN:-}" ]]; then
      log::info "Uploading E2E coverage to Codecov (flag: rhdh-e2e-frontend)..."
      local codecov_bin="/tmp/codecov"
      if [[ ! -x "$codecov_bin" ]]; then
        curl -sL -o "$codecov_bin" https://cli.codecov.io/latest/linux/codecov
        curl -sL -o "${codecov_bin}.SHA256SUM" https://cli.codecov.io/latest/linux/codecov.SHA256SUM
        if (cd /tmp && sha256sum --check --strict codecov.SHA256SUM); then
          rm -f "${codecov_bin}.SHA256SUM"
          chmod +x "$codecov_bin"
        else
          log::warn "Codecov CLI checksum verification failed — skipping upload"
          rm -f "$codecov_bin" "${codecov_bin}.SHA256SUM"
        fi
      fi
      if [[ -x "$codecov_bin" ]]; then
        # --fail-on-error makes the CLI exit non-zero on upload issues so we
        # can log it; the || ensures we never block the pipeline for coverage.
        "$codecov_bin" upload-process \
          --token "${CODECOV_TOKEN}" \
          --file "${e2e_tests_dir}/coverage/e2e/lcov.info" \
          --flag rhdh-e2e-frontend \
          --slug redhat-developer/rhdh \
          --fail-on-error || log::warn "Codecov E2E coverage upload failed (non-fatal)"
      fi
    else
      log::info "CODECOV_TOKEN not set — skipping Codecov upload. Coverage report saved as artifact."
    fi
  fi

  echo "Playwright project '${playwright_project}' in namespace '${namespace}' (artifacts: ${artifacts_subdir}) RESULT: ${test_result}"
  local test_passed="true"
  if [[ "${test_result}" -ne 0 ]]; then
    save_overall_result 1
    test_passed="false"
  fi
  # Use Playwright exit code as source of truth: flaky tests (failed initially
  # but passed on retry) report failures in JUnit XML even though they passed.
  # When test_result is 0, all tests ultimately passed — report 0 failures.
  local failed_tests
  if [[ "${test_result}" -eq 0 ]]; then
    failed_tests="0"
  else
    failed_tests=$(testing::_count_junit_failures "${e2e_tests_dir}/${JUNIT_RESULTS}")
    echo "Number of failed tests: ${failed_tests}"
  fi
  test_run_tracker::mark_test_result "$test_passed" "${failed_tests}"
  return "$test_result"
}

# Publishes a JUnit file to SHARED_DIR, gzipped to stay under the Kubernetes
# Secret 1 MiB limit; an oversized entry is dropped because it would break the
# downstream Slack reporting for every run in the job.
# Args:
#   $1 - artifacts_subdir (names the SHARED_DIR entry)
#   $2 - path to the JUnit file already copied into ARTIFACT_DIR
testing::_publish_junit_to_shared_dir() {
  local artifacts_subdir=$1 junit_in_artifact_dir=$2
  local target="${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz"
  local max_size=$((800 * 1024))

  [[ "${CI}" == "true" && -f "${junit_in_artifact_dir}" ]] || return 0

  gzip -c "${junit_in_artifact_dir}" > "${target}"
  local gz_size
  # stat is -c on GNU, -f on BSD; CI is GNU, local runs may not be.
  gz_size=$(stat -c%s "${target}" 2> /dev/null || stat -f%z "${target}")
  if ((gz_size > max_size)); then
    echo "[WARNING] $(basename "${target}") is $((gz_size / 1024)) KB, exceeds $((max_size / 1024)) KB limit. Removing from SHARED_DIR."
    rm -f "${target}"
  else
    echo "[INFO] Copied $(basename "${target}") to SHARED_DIR ($((gz_size / 1024)) KB)"
  fi
}

# Echoes the number of failed tests in a JUnit file, or UNKNOWN_FAILURE_COUNT
# when it cannot be determined. JUnit distinguishes "failures" (assertion
# failures) from "errors" (exceptions/timeouts) and Playwright reports
# TimeoutError and crashes as errors, so both are summed from the root
# <testsuites> element - otherwise the Slack notification under-reports.
# A zero total after a non-zero exit means the process crashed or timed out
# globally, so the sentinel is used instead of a misleading "0 tests failed".
# Args:
#   $1 - path to the JUnit file
testing::_count_junit_failures() {
  local junit_file=$1

  if [[ ! -f "${junit_file}" ]]; then
    log::warn "JUnit results file not found: ${junit_file}" >&2
    echo "${UNKNOWN_FAILURE_COUNT}"
    return 0
  fi

  local failures errors total
  failures=$(grep -oP 'failures="\K[0-9]+' "${junit_file}" | head -n 1)
  errors=$(grep -oP 'errors="\K[0-9]+' "${junit_file}" | head -n 1)
  total=$((${failures:-0} + ${errors:-0}))
  if [[ "${total}" -eq 0 ]]; then
    echo "${UNKNOWN_FAILURE_COUNT}"
  else
    echo "${total}"
  fi
}

# Scans RHDH pod logs in a namespace for dynamic-plugin startup failures and
# prints a summary naming each failed plugin. On CrashLoopBackOff the culprit is
# in the PREVIOUS container logs (-p). Advisory only: never fails.
# Args:
#   $1 - release_name: selects the RHDH pods
#   $2 - namespace
#   $3 - artifacts_subdir: where to save the summary artifact
testing::report_plugin_startup_failures() {
  local release_name=$1
  local namespace=$2
  local artifacts_subdir=$3
  local out="/tmp/plugin-startup-failures-${namespace}.txt"

  # Collected here rather than reused from save_all_pod_logs: that runs only when
  # a test fails, and its pod_logs/ directory is not namespace-scoped, so a
  # leftover copy would report another namespace's failures.
  #
  # One query yields both the pod list and whether anything actually crashed, so
  # a healthy run does not pay for two `oc logs` calls per pod.
  local pod_status
  pod_status=$(timeout 60 oc get pods -n "${namespace}" -l "app.kubernetes.io/instance in (${release_name},redhat-developer-hub,developer-hub)" \
    -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.phase}{" "}{range .status.containerStatuses[*]}{.restartCount}{" "}{end}{range .status.initContainerStatuses[*]}{.restartCount}{" "}{end}{"\n"}{end}' 2> /dev/null || true)

  if [[ -z "${pod_status//[[:space:]]/}" ]]; then
    # Distinct from "scanned and found nothing": a bad selector must not read as
    # a clean bill of health.
    log::warn "No RHDH pods matched in ${namespace}; skipping startup-failure scan."
    return 0
  fi

  # A plugin that fails startup fatally takes the backend down, so if every pod
  # is Running with no restarts there is nothing here to find.
  local unhealthy
  unhealthy=$(awk 'NF == 0 { next } $2 != "Running" { print $1; next } { for (i = 3; i <= NF; i++) if ($i != "0") { print $1; next } }' <<< "${pod_status}")
  if [[ -z "${unhealthy}" ]]; then
    log::info "All RHDH pods in ${namespace} are Running with no restarts; skipping startup-failure scan."
    return 0
  fi

  local pods
  pods=$(awk 'NF > 0 { print "pod/" $1 }' <<< "${pod_status}")

  {
    local pod
    for pod in ${pods}; do
      # Current and previous (pre-crash) logs; either may not exist yet.
      timeout 60 oc logs "${pod}" -n "${namespace}" --all-containers 2> /dev/null || true
      timeout 60 oc logs "${pod}" -n "${namespace}" --all-containers -p 2> /dev/null || true
    done
  } | "${DIR}/../../e2e-tests/local-harness/filter-plugin-startup-failures.sh" > "${out}" || true

  if [[ -s "${out}" ]]; then
    log::error "==================== PLUGIN STARTUP FAILURES (${namespace}) ===================="
    cat "${out}"
    log::error "==============================================================================="
    common::save_artifact "${artifacts_subdir}" "${out}" || true
  else
    log::info "No dynamic-plugin startup failures found in ${namespace} pod logs."
  fi
}

# ==============================================================================
# Health Checks
# ==============================================================================

# Check if Backstage is up and running at the given URL
# Args:
#   $1 - release_name: The Helm release name
#   $2 - namespace: The namespace where Backstage is deployed
#   $3 - url: The URL to check
#   $4 - artifacts_subdir: (optional) Subdirectory for artifacts (defaults to namespace)
#   $5 - max_attempts: (optional) Maximum number of attempts (default: 30)
#   $6 - wait_seconds: (optional) Seconds to wait between attempts (default: 30)
# Returns:
#   0 - Backstage is running
#   1 - Backstage is not running or crashed
testing::check_backstage_running() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local artifacts_subdir=$4
  local max_attempts=${5:-30}
  local wait_seconds=${6:-30}

  if [[ -z "$release_name" || -z "$namespace" || -z "$url" || -z "$artifacts_subdir" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::check_backstage_running <release_name> <namespace> <url> <artifacts_subdir> [max_attempts] [wait_seconds]"
    return 1
  fi

  log::info "Checking if Backstage is up and running at ${url}"

  for ((i = 1; i <= max_attempts; i++)); do
    # Check HTTP status
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}" || echo "000")

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
        common::save_artifact "${artifacts_subdir}" "/tmp/${LOGFILE}" || true
        return 1
      fi

      sleep "${wait_seconds}"
    fi
  done

  log::error "Failed to reach Backstage at ${url} after ${max_attempts} attempts."
  oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -10
  common::save_artifact "${artifacts_subdir}" "/tmp/${LOGFILE}" || true
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
#   $7 - artifacts_subdir: (optional) Subdirectory for artifacts (defaults to playwright_project)
# Uses globals: SKIP_TESTS
testing::check_and_test() {
  local release_name=$1
  local namespace=$2
  local playwright_project=$3
  local url=$4
  local max_attempts=${5:-30}
  local wait_seconds=${6:-30}
  local artifacts_subdir="${7:-$playwright_project}"

  if [[ -z "$release_name" || -z "$namespace" || -z "$playwright_project" || -z "$url" ]]; then
    log::error "${_TESTING_ERR_MISSING_PARAMS}"
    log::info "Usage: testing::check_and_test <release_name> <namespace> <playwright_project> <url> [max_attempts] [wait_seconds] [artifacts_subdir]"
    return 1
  fi

  if testing::check_backstage_running "${release_name}" "${namespace}" "${url}" "${artifacts_subdir}" "${max_attempts}" "${wait_seconds}"; then
    echo "Display pods for verification..."
    oc get pods -n "${namespace}"
    if [[ "${SKIP_TESTS:-false}" == "true" ]]; then
      log::info "SKIP_TESTS=true, skipping test execution for namespace: ${namespace}"
    else
      # Collect pod logs only on test failure to speed up successful PR runs.
      if testing::run_tests "${release_name}" "${namespace}" "${playwright_project}" "${url}" "${artifacts_subdir}"; then
        log::info "Tests passed — skipping pod log collection for namespace: ${namespace}"
      else
        save_all_pod_logs "$namespace" "$artifacts_subdir"
      fi
    fi
  else
    echo "Backstage is not running. Marking deployment as failed and continuing..."
    test_run_tracker::mark_deploy_failed "$artifacts_subdir"
    save_all_pod_logs "$namespace" "$artifacts_subdir"
  fi
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
    test_run_tracker::mark_deploy_failed "$playwright_project"
  fi
  return 0
}
