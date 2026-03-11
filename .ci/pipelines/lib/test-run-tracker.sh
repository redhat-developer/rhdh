#!/bin/bash

# Prevent sourcing multiple times in the same shell.
if [[ -n "${RHDH_TEST_RUN_TRACKER_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_TEST_RUN_TRACKER_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/reporting.sh
source "$(dirname "${BASH_SOURCE[0]}")/../reporting.sh"

# Internal state
_TEST_RUN_COUNTER=0

test_run_tracker::next_id() {
  _TEST_RUN_COUNTER=$((_TEST_RUN_COUNTER + 1))
  echo "${_TEST_RUN_COUNTER}"
}

test_run_tracker::current_id() {
  echo "${_TEST_RUN_COUNTER}"
}

test_run_tracker::register() {
  local label="$1"
  test_run_tracker::next_id > /dev/null
  save_status_deployment_namespace "${_TEST_RUN_COUNTER}" "$label"
}

test_run_tracker::mark_deploy_success() {
  save_status_failed_to_deploy "${_TEST_RUN_COUNTER}" false
}

test_run_tracker::mark_deploy_failed() {
  local label="$1"
  test_run_tracker::register "$label"
  save_status_failed_to_deploy "${_TEST_RUN_COUNTER}" true
  save_status_test_failed "${_TEST_RUN_COUNTER}" true
  save_status_number_of_test_failed "${_TEST_RUN_COUNTER}" "N/A"
  save_overall_result 1
}

test_run_tracker::mark_test_result() {
  local passed="$1"
  local num_failures="${2:-0}"
  if [[ "$passed" == "true" ]]; then
    save_status_test_failed "${_TEST_RUN_COUNTER}" false
  else
    save_status_test_failed "${_TEST_RUN_COUNTER}" true
  fi
  save_status_number_of_test_failed "${_TEST_RUN_COUNTER}" "$num_failures"
}

# Export all functions for subshell compatibility.
# Note: _TEST_RUN_COUNTER is NOT exported because subshells inherit only
# the snapshot at fork time — counter updates in the parent would not propagate.
export -f test_run_tracker::next_id
export -f test_run_tracker::current_id
export -f test_run_tracker::register
export -f test_run_tracker::mark_deploy_success
export -f test_run_tracker::mark_deploy_failed
export -f test_run_tracker::mark_test_result
