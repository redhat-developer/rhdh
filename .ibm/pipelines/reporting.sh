#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$(dirname "${BASH_SOURCE[0]}")"/lib/log.sh

# Variables for reporting
export CURRENT_DEPLOYMENT=0        # Counter for current deployment.
export STATUS_DEPLOYMENT_NAMESPACE # Array that holds the namespaces of deployments.
export STATUS_FAILED_TO_DEPLOY     # Array that indicates if deployment failed. false = success, true = failure
export STATUS_TEST_FAILED          # Array that indicates if test run failed. false = success, true = failure
export OVERALL_RESULT              # Overall result of the test run. 0 = success, 1 = failure

mkdir -p "$ARTIFACT_DIR/reporting"

save_status_deployment_namespace() {
  local current_deployment=$1
  local current_namespace=$2
  log::debug "Saving STATUS_DEPLOYMENT_NAMESPACE[\"${current_deployment}\"]=${current_namespace}"
  STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]="${current_namespace}"
  printf "%s\n" "${STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt"
  cp "$SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt" "$ARTIFACT_DIR/reporting/STATUS_DEPLOYMENT_NAMESPACE.txt"
}

save_status_failed_to_deploy() {
  local current_deployment=$1
  local status=$2
  log::debug "Saving STATUS_FAILED_TO_DEPLOY[\"${current_deployment}\"]=${status}"
  STATUS_FAILED_TO_DEPLOY["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_FAILED_TO_DEPLOY["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt"
  cp "$SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt" "$ARTIFACT_DIR/reporting/STATUS_FAILED_TO_DEPLOY.txt"
}

save_status_test_failed() {
  local current_deployment=$1
  local status=$2
  log::debug "Saving STATUS_TEST_FAILED[\"${current_deployment}\"]=${status}"
  STATUS_TEST_FAILED["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_TEST_FAILED["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_TEST_FAILED.txt"
  cp "$SHARED_DIR/STATUS_TEST_FAILED.txt" "$ARTIFACT_DIR/reporting/STATUS_TEST_FAILED.txt"
}

save_status_number_of_test_failed() {
  local current_deployment=$1
  local number=$2
  log::debug "Saving STATUS_NUMBER_OF_TEST_FAILED[\"${current_deployment}\"]=${number}"
  STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]="${number}"
  printf "%s\n" "${STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt"
  cp "$SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt" "$ARTIFACT_DIR/reporting/STATUS_NUMBER_OF_TEST_FAILED.txt"
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
