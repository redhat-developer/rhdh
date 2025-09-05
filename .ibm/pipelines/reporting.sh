#!/bin/bash

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

get_artifacts_url() {
  local project="${1:-""}"

  local artifacts_base_url="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results"
  local artifacts_complete_url
  if [ -n "${PULL_NUMBER:-}" ]; then
    artifacts_complete_url="${artifacts_base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}/artifacts/e2e-tests/${REPO_OWNER}-${REPO_NAME}/artifacts/${project}"
  else
    local part_1="${JOB_NAME##periodic-ci-redhat-developer-rhdh-"${RELEASE_BRANCH_NAME}"-}" # e.g. "e2e-tests-aks-helm-nightly"
    local suite_name="${JOB_NAME##periodic-ci-redhat-developer-rhdh-"${RELEASE_BRANCH_NAME}"-e2e-tests-}" # e.g. "aks-helm-nightly"
    local part_2="redhat-developer-rhdh-${suite_name}" # e.g. "redhat-developer-rhdh-aks-helm-nightly"
    # Override part_2 based for specific cases that do not follow the standard naming convention.
    case "$JOB_NAME" in
      *osd-gcp*)
      part_2="redhat-developer-rhdh-osd-gcp-nightly"
      ;;
      *ocp-v*)
      part_2="redhat-developer-rhdh-nightly"
      ;;
    esac
    artifacts_complete_url="${artifacts_base_url}/logs/${JOB_NAME}/${BUILD_ID}/artifacts/${part_1}/${part_2}/artifacts/${project}"
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
  if [[ "${JOB_NAME}" == *rehearse* ]]; then return 0; fi

  local project=$1

  ARTIFACTS_URL=$(get_artifacts_url)

  # Remove properties (only used for skipped test and invalidates the file if empty)
  sed_inplace '/<properties>/,/<\/properties>/d' "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}"
  # Replace attachments with link to OpenShift CI storage
  sed_inplace "s#\[\[ATTACHMENT|\(.*\)\]\]#${ARTIFACTS_URL}/\1#g" "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}"

  # Copy the metadata and JUnit results files to the shared directory
  cp "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}" "${SHARED_DIR}/junit-results-${project}.xml"

  echo "🗃️ JUnit results for ${project} adapted to Data Router format and saved to ARTIFACT_DIR and copied to SHARED_DIR"
  echo "Shared directory contents:"
  ls -la "${SHARED_DIR}"
}
