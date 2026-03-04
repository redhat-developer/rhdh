#!/bin/bash

# Prevent sourcing multiple times in the same shell.
if [[ -n "${RHDH_DEPLOYMENT_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_DEPLOYMENT_LIB_SOURCED=1

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
  local namespace="$1"
  deployment::next_id > /dev/null
  save_status_deployment_namespace "${_DEPLOYMENT_COUNTER}" "$namespace"
}

deployment::mark_deploy_success() {
  save_status_failed_to_deploy "${_DEPLOYMENT_COUNTER}" false
}

deployment::mark_deploy_failed() {
  local namespace="$1"
  deployment::register "$namespace"
  save_status_failed_to_deploy "${_DEPLOYMENT_COUNTER}" true
  save_status_test_failed "${_DEPLOYMENT_COUNTER}" true
  save_overall_result 1
}

deployment::mark_test_result() {
  local passed="$1"
  local num_failures="${2:-}"
  if [[ "$passed" == "true" ]]; then
    save_status_test_failed "${_DEPLOYMENT_COUNTER}" false
  else
    save_status_test_failed "${_DEPLOYMENT_COUNTER}" true
  fi
  if [[ -n "$num_failures" ]]; then
    save_status_number_of_test_failed "${_DEPLOYMENT_COUNTER}" "$num_failures"
  fi
}

# Export all functions and state for subshell compatibility
export _DEPLOYMENT_COUNTER
export -f deployment::next_id
export -f deployment::current_id
export -f deployment::register
export -f deployment::mark_deploy_success
export -f deployment::mark_deploy_failed
export -f deployment::mark_test_result
