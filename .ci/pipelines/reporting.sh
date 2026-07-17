#!/bin/bash

# Prevent re-sourcing
if [[ -n "${REPORTING_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly REPORTING_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "$(dirname "${BASH_SOURCE[0]}")"/lib/log.sh

# Variables for reporting
export STATUS_DEPLOYMENT_NAMESPACE  # Array that holds the namespaces of deployments.
export STATUS_FAILED_TO_DEPLOY      # Array that indicates if deployment failed. false = success, true = failure
export STATUS_TEST_FAILED           # Array that indicates if test run failed. false = success, true = failure
export STATUS_NUMBER_OF_TEST_FAILED # Array that holds the number of test failures per deployment.
export OVERALL_RESULT               # Overall result of the test run. 0 = success, 1 = failure

mkdir -p "$ARTIFACT_DIR/reporting"

save_status_deployment_namespace() {
  local current_deployment=$1
  local current_namespace=$2
  log::debug "Saving STATUS_DEPLOYMENT_NAMESPACE[\"${current_deployment}\"]=${current_namespace}"
  STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]="${current_namespace}"
  _regenerate_status_file "STATUS_DEPLOYMENT_NAMESPACE"
}

save_status_failed_to_deploy() {
  local current_deployment=$1
  local status=$2
  log::debug "Saving STATUS_FAILED_TO_DEPLOY[\"${current_deployment}\"]=${status}"
  STATUS_FAILED_TO_DEPLOY["${current_deployment}"]="${status}"
  _regenerate_status_file "STATUS_FAILED_TO_DEPLOY"
}

save_status_test_failed() {
  local current_deployment=$1
  local status=$2
  log::debug "Saving STATUS_TEST_FAILED[\"${current_deployment}\"]=${status}"
  STATUS_TEST_FAILED["${current_deployment}"]="${status}"
  _regenerate_status_file "STATUS_TEST_FAILED"
}

save_status_number_of_test_failed() {
  local current_deployment=$1
  local number=$2
  log::debug "Saving STATUS_NUMBER_OF_TEST_FAILED[\"${current_deployment}\"]=${number}"
  STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]="${number}"
  _regenerate_status_file "STATUS_NUMBER_OF_TEST_FAILED"
}

# Regenerate a STATUS file from its in-memory associative array.
# Writes the file from scratch each time so that the same deployment ID
# can be safely updated multiple times (e.g. pessimistic default written
# before Playwright runs, then overwritten with the real result).
#
# IMPORTANT: All callers must run in the same shell process.
# Associative arrays are not inherited by child processes (export -f
# only exports function definitions, not array contents). If this
# function runs in a subshell, it will see an empty array and truncate
# the file. This is fine today — all test_run_tracker calls are
# sequential in the main shell.
_regenerate_status_file() {
  local var_name=$1
  local -n _arr="${var_name}"
  local file="$SHARED_DIR/${var_name}.txt"
  : > "$file"
  local key
  for key in $(printf '%s\n' "${!_arr[@]}" | sort -n); do
    printf '%s\n' "${_arr[$key]}" >> "$file"
  done
  cp "$file" "$ARTIFACT_DIR/reporting/${var_name}.txt"
}

save_overall_result() {
  local result=$1
  OVERALL_RESULT=${result}
  log::info "Saving OVERALL_RESULT=${OVERALL_RESULT}"
  printf "%s" "${OVERALL_RESULT}" > "$SHARED_DIR/OVERALL_RESULT.txt"
  cp "$SHARED_DIR/OVERALL_RESULT.txt" "$ARTIFACT_DIR/reporting/OVERALL_RESULT.txt"
}

save_is_openshift() {
  local is_openshift=$1
  log::debug "Saving IS_OPENSHIFT=${is_openshift}"
  printf "%s" "${is_openshift}" > "$SHARED_DIR/IS_OPENSHIFT.txt"
  cp "$SHARED_DIR/IS_OPENSHIFT.txt" "$ARTIFACT_DIR/reporting/IS_OPENSHIFT.txt"
}

save_container_platform() {
  local container_platform=$1
  local container_platform_version=$2
  log::debug "Saving CONTAINER_PLATFORM=${container_platform}"
  log::debug "Saving CONTAINER_PLATFORM_VERSION=${container_platform_version}"
  printf "%s" "${container_platform}" > "$SHARED_DIR/CONTAINER_PLATFORM.txt"
  printf "%s" "${container_platform_version}" > "$SHARED_DIR/CONTAINER_PLATFORM_VERSION.txt"
  cp "$SHARED_DIR/CONTAINER_PLATFORM.txt" "$ARTIFACT_DIR/reporting/CONTAINER_PLATFORM.txt"
  cp "$SHARED_DIR/CONTAINER_PLATFORM_VERSION.txt" "$ARTIFACT_DIR/reporting/CONTAINER_PLATFORM_VERSION.txt"
}
