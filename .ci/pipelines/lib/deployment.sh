#!/bin/bash

# Prevent sourcing multiple times in the same shell.
if [[ -n "${RHDH_DEPLOYMENT_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_DEPLOYMENT_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/reporting.sh
source "$(dirname "${BASH_SOURCE[0]}")/../reporting.sh"

# Internal state
_DEPLOYMENT_COUNTER=0

deployment::next_id() {
  _DEPLOYMENT_COUNTER=$((_DEPLOYMENT_COUNTER + 1))
  echo "${_DEPLOYMENT_COUNTER}"
}

deployment::current_id() {
  echo "${_DEPLOYMENT_COUNTER}"
}

deployment::register() {
  local label="$1"
  deployment::next_id > /dev/null
  save_status_deployment_namespace "${_DEPLOYMENT_COUNTER}" "$label"
}

deployment::mark_deploy_success() {
  save_status_failed_to_deploy "${_DEPLOYMENT_COUNTER}" false
}

deployment::mark_deploy_failed() {
  local label="$1"
  deployment::register "$label"
  save_status_failed_to_deploy "${_DEPLOYMENT_COUNTER}" true
  save_status_test_failed "${_DEPLOYMENT_COUNTER}" true
  save_status_number_of_test_failed "${_DEPLOYMENT_COUNTER}" "N/A"
  save_overall_result 1
}

deployment::mark_test_result() {
  local passed="$1"
  local num_failures="${2:-0}"
  if [[ "$passed" == "true" ]]; then
    save_status_test_failed "${_DEPLOYMENT_COUNTER}" false
  else
    save_status_test_failed "${_DEPLOYMENT_COUNTER}" true
  fi
  save_status_number_of_test_failed "${_DEPLOYMENT_COUNTER}" "$num_failures"
}

# Export all functions for subshell compatibility.
# Note: _DEPLOYMENT_COUNTER is NOT exported because subshells inherit only
# the snapshot at fork time — counter updates in the parent would not propagate.
export -f deployment::next_id
export -f deployment::current_id
export -f deployment::register
export -f deployment::mark_deploy_success
export -f deployment::mark_deploy_failed
export -f deployment::mark_test_result
