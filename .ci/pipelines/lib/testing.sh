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
  if [[ "${CI}" == "true" && -f "${ARTIFACT_DIR}/${artifacts_subdir}/${JUNIT_RESULTS}" ]]; then
    # Gzip junit before writing to SHARED_DIR to stay under Kubernetes Secret 1 MiB limit
    gzip -c "${ARTIFACT_DIR}/${artifacts_subdir}/${JUNIT_RESULTS}" > "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz"
    local gz_size
    gz_size=$(stat -c%s "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz" 2> /dev/null || stat -f%z "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz")
    local max_size=$((800 * 1024))
    if ((gz_size > max_size)); then
      echo "[WARNING] junit-results-${artifacts_subdir}.xml.gz is $((gz_size / 1024)) KB, exceeds $((max_size / 1024)) KB limit. Removing from SHARED_DIR."
      rm -f "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz"
    else
      echo "[INFO] Copied junit-results-${artifacts_subdir}.xml.gz to SHARED_DIR ($((gz_size / 1024)) KB)"
    fi
  fi

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
  elif [[ -f "${e2e_tests_dir}/${JUNIT_RESULTS}" ]]; then
    # JUnit XML distinguishes "failures" (assertion failures) from "errors"
    # (exceptions/timeouts). Playwright reports TimeoutError, crash, and
    # similar issues as errors, not failures. Sum both from the root
    # <testsuites> element so the Slack notification reflects the real count.
    local _junit_failures _junit_errors
    _junit_failures=$(grep -oP 'failures="\K[0-9]+' "${e2e_tests_dir}/${JUNIT_RESULTS}" | head -n 1)
    _junit_errors=$(grep -oP 'errors="\K[0-9]+' "${e2e_tests_dir}/${JUNIT_RESULTS}" | head -n 1)
    _junit_failures="${_junit_failures:-0}"
    _junit_errors="${_junit_errors:-0}"
    failed_tests=$((_junit_failures + _junit_errors))
    if [[ "${failed_tests}" -eq 0 ]]; then
      # Playwright exited non-zero but JUnit reports 0 failures and 0 errors —
      # the process likely crashed or timed out globally. Use the sentinel so
      # the Slack alert doesn't misleadingly say "0 tests failed".
      failed_tests="${UNKNOWN_FAILURE_COUNT}"
    fi
    echo "Number of failed tests: ${failed_tests}"
  else
    echo "JUnit results file not found: ${e2e_tests_dir}/${JUNIT_RESULTS}"
    failed_tests="${UNKNOWN_FAILURE_COUNT}"
    echo "Number of failed tests unknown, saving as ${failed_tests}."
  fi
  test_run_tracker::mark_test_result "$test_passed" "${failed_tests}"
  return "$test_result"
}

# Filters stdin down to the dynamic-plugin startup failures worth reporting.
# Backstage emits three fatal shapes (createInitializationResultCollector):
# "Plugin '<id>' threw an error during startup", "Module '<m>' in Plugin
# '<id>' threw an error during startup", and "Plugin '<id>' reported failure
# for module '<m>' during startup". The near-identical variants that end in
# "boot failure is permitted ... so startup will continue" are NON-fatal and
# must not be reported as failures.
testing::_filter_plugin_startup_failures() {
  grep -E "(threw an error|reported failure for module).*during startup|Backend startup failed" \
    | grep -v "boot failure is permitted" \
    | sort -u
}

# Scans RHDH pod logs in a namespace for dynamic-plugin startup failures and
# prints a loud, grep-free summary naming each failed plugin. Backstage logs
# "Plugin '<id>' threw an error during startup ..." / "Module <m> in Plugin
# '<id>' threw an error ..." before the pod exits, so on CrashLoopBackOff the
# culprit is in the PREVIOUS container logs (-p). Advisory only: never fails.
# Args:
#   $1 - namespace
#   $2 - artifacts_subdir: where to save the summary artifact
testing::report_plugin_startup_failures() {
  local namespace=$1
  local artifacts_subdir=$2
  local out="/tmp/plugin-startup-failures-${namespace}.txt"

  {
    local pod
    for pod in $(oc get pods -n "${namespace}" -o name 2> /dev/null | grep -E 'backstage|developer-hub' || true); do
      # Current and previous (pre-crash) logs; either may not exist yet.
      oc logs "${pod}" -n "${namespace}" --all-containers 2> /dev/null || true
      oc logs "${pod}" -n "${namespace}" --all-containers -p 2> /dev/null || true
    done
  } | testing::_filter_plugin_startup_failures > "${out}" || true

  if [[ -s "${out}" ]]; then
    log::error "==================== PLUGIN STARTUP FAILURES (${namespace}) ===================="
    cat "${out}"
    log::error "==============================================================================="
    common::save_artifact "${artifacts_subdir}" "${out}" || true
  else
    log::info "No dynamic-plugin startup failures found in ${namespace} pod logs."
  fi
}

# Cluster-free plugin sanity check (RHIDP-13508): boots packages/backend from
# source with every OCI plugin declared by the catalog index and verifies -
# via /api/dynamic-plugins-info/loaded-plugins - that the product's dynamic
# plugin loader loaded all of them. Runs entirely inside the test pod: no
# cluster deployment and no product image (see
# e2e-tests/playwright.plugin-sanity.config.ts).
# Args:
#   $1 - artifacts_subdir: (optional) Subdirectory for artifacts (defaults to plugin-dynamic-loading)
testing::run_plugin_sanity_check() {
  local artifacts_subdir="${1:-plugin-dynamic-loading}"

  test_run_tracker::register "$artifacts_subdir"
  test_run_tracker::mark_deploy_success
  # Pessimistic default, same rationale as testing::run_tests.
  test_run_tracker::mark_test_result "false" "${UNKNOWN_FAILURE_COUNT}"

  # Branch-aware nightly index by default; overridable via Gangway
  # (--catalog-index-image), e.g. for RC verification.
  export CATALOG_INDEX_IMAGE="${CATALOG_INDEX_IMAGE:-quay.io/rhdh/plugin-catalog-index:${RELEASE_VERSION}}"
  log::info "Running cluster-free plugin sanity check against ${CATALOG_INDEX_IMAGE}"

  local repo_root
  repo_root="$(cd "${DIR}/../.." && pwd)"

  # Booting packages/backend from source needs the ROOT workspace dependencies
  # (e2e-tests has its own lockfile, installed separately below).
  if ! (cd "${repo_root}" && yarn install --immutable > /tmp/yarn.install.root.log.txt 2>&1); then
    log::error "=== ROOT YARN INSTALL FAILED ==="
    cat /tmp/yarn.install.root.log.txt
    save_overall_result 1
    return 1
  fi
  log::success "Root yarn install completed successfully."

  "${repo_root}/e2e-tests/local-harness/populate-catalog-index.sh" 2>&1 | tee "/tmp/${LOGFILE}-plugin-sanity-populate"
  local populate_result=${PIPESTATUS[0]}
  if [[ "${populate_result}" -ne 0 ]]; then
    log::error "populate-catalog-index.sh failed (exit ${populate_result})"
    save_overall_result 1
    return 1
  fi

  # Must record the failure like every other path here: a bare return would
  # leave OVERALL_RESULT green while the tracker row says the run failed.
  cd "${repo_root}/e2e-tests" || {
    log::error "Could not enter ${repo_root}/e2e-tests"
    save_overall_result 1
    return 1
  }

  if ! yarn install --immutable > /tmp/yarn.install.log.txt 2>&1; then
    log::error "=== YARN INSTALL FAILED ==="
    cat /tmp/yarn.install.log.txt
    save_overall_result 1
    return 1
  fi

  local junit_results="junit-results-plugin-sanity.xml"
  (
    set -e
    JUNIT_RESULTS="${junit_results}" yarn plugin-sanity
  ) 2>&1 | tee "/tmp/${LOGFILE}-plugin-sanity"
  local test_result=${PIPESTATUS[0]}

  common::save_artifact "${artifacts_subdir}" "${repo_root}/e2e-tests/${junit_results}" || true
  if [[ "${CI}" == "true" && -f "${ARTIFACT_DIR}/${artifacts_subdir}/${junit_results}" ]]; then
    # Gzip junit before writing to SHARED_DIR to stay under Kubernetes Secret 1 MiB limit
    gzip -c "${ARTIFACT_DIR}/${artifacts_subdir}/${junit_results}" > "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz"
    local gz_size
    gz_size=$(stat -c%s "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz" 2> /dev/null || stat -f%z "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz")
    local max_size=$((800 * 1024))
    if ((gz_size > max_size)); then
      echo "[WARNING] junit-results-${artifacts_subdir}.xml.gz is $((gz_size / 1024)) KB, exceeds $((max_size / 1024)) KB limit. Removing from SHARED_DIR."
      rm -f "${SHARED_DIR}/junit-results-${artifacts_subdir}.xml.gz"
    else
      echo "[INFO] Copied junit-results-${artifacts_subdir}.xml.gz to SHARED_DIR ($((gz_size / 1024)) KB)"
    fi
  fi

  ansi2html < "/tmp/${LOGFILE}-plugin-sanity" > "/tmp/${LOGFILE}-plugin-sanity.html"
  common::save_artifact "${artifacts_subdir}" "/tmp/${LOGFILE}-plugin-sanity.html" || true
  common::save_artifact "${artifacts_subdir}" "${repo_root}/e2e-tests/playwright-report-plugin-sanity/" || true

  echo "Cluster-free plugin sanity check (artifacts: ${artifacts_subdir}) RESULT: ${test_result}"
  local test_passed="true"
  if [[ "${test_result}" -ne 0 ]]; then
    save_overall_result 1
    test_passed="false"
    # The backend log streams through Playwright's webServer pipe into the run
    # log; surface the per-plugin startup failures so nobody has to dig.
    local failures_out="/tmp/plugin-startup-failures-cluster-free.txt"
    testing::_filter_plugin_startup_failures < "/tmp/${LOGFILE}-plugin-sanity" > "${failures_out}" || true
    if [[ -s "${failures_out}" ]]; then
      log::error "==================== PLUGIN STARTUP FAILURES (cluster-free) ===================="
      cat "${failures_out}"
      log::error "================================================================================="
      common::save_artifact "${artifacts_subdir}" "${failures_out}" || true
    fi
  fi
  local failed_tests="0"
  if [[ "${test_result}" -ne 0 ]]; then
    if [[ -f "${repo_root}/e2e-tests/${junit_results}" ]]; then
      local _junit_failures _junit_errors
      _junit_failures=$(grep -oP 'failures="\K[0-9]+' "${repo_root}/e2e-tests/${junit_results}" | head -n 1)
      _junit_errors=$(grep -oP 'errors="\K[0-9]+' "${repo_root}/e2e-tests/${junit_results}" | head -n 1)
      _junit_failures="${_junit_failures:-0}"
      _junit_errors="${_junit_errors:-0}"
      failed_tests=$((_junit_failures + _junit_errors))
      if [[ "${failed_tests}" -eq 0 ]]; then
        failed_tests="${UNKNOWN_FAILURE_COUNT}"
      fi
    else
      failed_tests="${UNKNOWN_FAILURE_COUNT}"
    fi
    echo "Number of failed tests: ${failed_tests}"
  fi
  test_run_tracker::mark_test_result "$test_passed" "${failed_tests}"
  return "$test_result"
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
