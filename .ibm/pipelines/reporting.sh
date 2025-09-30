#!/bin/bash

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
  echo "Saving STATUS_DEPLOYMENT_NAMESPACE[\"${current_deployment}\"]=${current_namespace}"
  STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]="${current_namespace}"
  printf "%s\n" "${STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt"
  cp "$SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt" "$ARTIFACT_DIR/reporting/STATUS_DEPLOYMENT_NAMESPACE.txt"
}

save_status_failed_to_deploy() {
  local current_deployment=$1
  local status=$2
  echo "Saving STATUS_FAILED_TO_DEPLOY[\"${current_deployment}\"]=${status}"
  STATUS_FAILED_TO_DEPLOY["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_FAILED_TO_DEPLOY["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt"
  cp "$SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt" "$ARTIFACT_DIR/reporting/STATUS_FAILED_TO_DEPLOY.txt"
}

save_status_test_failed() {
  local current_deployment=$1
  local status=$2
  echo "Saving STATUS_TEST_FAILED[\"${current_deployment}\"]=${status}"
  STATUS_TEST_FAILED["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_TEST_FAILED["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_TEST_FAILED.txt"
  cp "$SHARED_DIR/STATUS_TEST_FAILED.txt" "$ARTIFACT_DIR/reporting/STATUS_TEST_FAILED.txt"
}

save_status_number_of_test_failed() {
  local current_deployment=$1
  local number=$2
  echo "Saving STATUS_NUMBER_OF_TEST_FAILED[\"${current_deployment}\"]=${number}"
  STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]="${number}"
  printf "%s\n" "${STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt"
  cp "$SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt" "$ARTIFACT_DIR/reporting/STATUS_NUMBER_OF_TEST_FAILED.txt"
}

save_overall_result() {
  local result=$1
  OVERALL_RESULT=${result}
  echo "Saving OVERALL_RESULT=${OVERALL_RESULT}"
  printf "%s" "${OVERALL_RESULT}" > "$SHARED_DIR/OVERALL_RESULT.txt"
  cp "$SHARED_DIR/OVERALL_RESULT.txt" "$ARTIFACT_DIR/reporting/OVERALL_RESULT.txt"
}

save_is_openshift() {
  local is_openshift=$1
  echo "Saving IS_OPENSHIFT=${is_openshift}"
  printf "%s" "${is_openshift}" > "$SHARED_DIR/IS_OPENSHIFT.txt"
  cp "$SHARED_DIR/IS_OPENSHIFT.txt" "$ARTIFACT_DIR/reporting/IS_OPENSHIFT.txt"
}

save_container_platform() {
  local container_platform=$1
  local container_platform_version=$2
  echo "Saving CONTAINER_PLATFORM=${container_platform}"
  echo "Saving CONTAINER_PLATFORM_VERSION=${container_platform_version}"
  printf "%s" "${container_platform}" > "$SHARED_DIR/CONTAINER_PLATFORM.txt"
  printf "%s" "${container_platform_version}" > "$SHARED_DIR/CONTAINER_PLATFORM_VERSION.txt"
  cp "$SHARED_DIR/CONTAINER_PLATFORM.txt" "$ARTIFACT_DIR/reporting/CONTAINER_PLATFORM.txt"
  cp "$SHARED_DIR/CONTAINER_PLATFORM_VERSION.txt" "$ARTIFACT_DIR/reporting/CONTAINER_PLATFORM_VERSION.txt"
}

get_artifacts_url() {
  local namespace=$1

  if [ -z "${namespace}" ]; then
    echo "Warning: namespace parameter is empty (this is expected only for top level artifacts directory)" >&2
  fi

  local artifacts_base_url="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results"
  local artifacts_complete_url
  if [ -n "${PULL_NUMBER:-}" ]; then
    local part_1="${JOB_NAME##pull-ci-redhat-developer-rhdh-main-}"         # e.g. "e2e-ocp-operator-nightly"
    local suite_name="${JOB_NAME##pull-ci-redhat-developer-rhdh-main-e2e-}" # e.g. "ocp-operator-nightly"
    local part_2="redhat-developer-rhdh-${suite_name}"                      # e.g. "redhat-developer-rhdh-ocp-operator-nightly"
    # Override part_2 based for specific cases that do not follow the standard naming convention.
    case "$JOB_NAME" in
      *osd-gcp*)
        part_2="redhat-developer-rhdh-osd-gcp-helm-nightly"
        ;;
      *ocp-v*helm*-nightly*)
        part_2="redhat-developer-rhdh-ocp-helm-nightly"
        ;;
    esac
    artifacts_complete_url="${artifacts_base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}/artifacts/${part_1}/${part_2}/artifacts/${namespace}"
  else
    local part_1="${JOB_NAME##periodic-ci-redhat-developer-rhdh-"${RELEASE_BRANCH_NAME}"-}"         # e.g. "e2e-aks-helm-nightly"
    local suite_name="${JOB_NAME##periodic-ci-redhat-developer-rhdh-"${RELEASE_BRANCH_NAME}"-e2e-}" # e.g. "aks-helm-nightly"
    local part_2="redhat-developer-rhdh-${suite_name}"                                              # e.g. "redhat-developer-rhdh-aks-helm-nightly"
    # Override part_2 based for specific cases that do not follow the standard naming convention.
    case "$JOB_NAME" in
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

get_job_url() {
  local job_base_url="https://prow.ci.openshift.org/view/gs/test-platform-results"
  local job_complete_url
  if [ -n "${PULL_NUMBER:-}" ]; then
    job_complete_url="${job_base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}"
  else
    job_complete_url="${job_base_url}/logs/${JOB_NAME}/${BUILD_ID}"
  fi
  echo "${job_complete_url}"
}

save_data_router_junit_results() {
  if [[ "${OPENSHIFT_CI}" != "true" ]]; then return 0; fi

  local namespace=$1

  ARTIFACTS_URL=$(get_artifacts_url "${namespace}")

  cp "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}.original.xml"

  # Replace attachments with link to OpenShift CI storage
  sed -i "s#\[\[ATTACHMENT|\(.*\)\]\]#${ARTIFACTS_URL}/\1#g" "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}"

  # Convert XML property tags from self-closing format to self-closing format
  # This handles cases where properties have both opening and closing tags
  # Step 1: Remove all closing property tags
  sed -i 's#</property>##g' "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}"
  # Step 2: Convert opening property tags to self-closing format
  sed -i 's#<property name="\([^"]*\)" value="\([^"]*\)">#<property name="\1" value="\2"/>#g' "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}"

  # Copy the metadata and JUnit results files to the shared directory
  cp "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" "${SHARED_DIR}/junit-results-${namespace}.xml"

  echo "🗃️ JUnit results for ${namespace} adapted to Data Router format and saved to ARTIFACT_DIR and copied to SHARED_DIR"
  echo "Shared directory contents:"
  ls -la "${SHARED_DIR}"
}
