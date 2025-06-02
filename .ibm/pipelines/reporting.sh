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
  echo "Saving STATUS_TEST_FAILED[\"${current_deployment}\"]=${number}"
  STATUS_TEST_FAILED["${current_deployment}"]="${number}"
  printf "%s\n" "${STATUS_NUMBER_OF_TEST_FAILED["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt"
  cp "$SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt" "$ARTIFACT_DIR/reporting/STATUS_NUMBER_OF_TEST_FAILED.txt"
}

save_status_url_reportportal() {
  local current_deployment=$1
  local url=$2
  echo "Saving STATUS_URL_REPORTPORTAL[\"${current_deployment}\"]"
  STATUS_URL_REPORTPORTAL["${current_deployment}"]="${url}"
  printf "%s\n" "${STATUS_URL_REPORTPORTAL["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_URL_REPORTPORTAL.txt"
  cp "$SHARED_DIR/STATUS_URL_REPORTPORTAL.txt" "$ARTIFACT_DIR/reporting/STATUS_URL_REPORTPORTAL.txt"
}

save_overall_result() {
  local result=$1
  OVERALL_RESULT=${result}
  echo "Saving OVERALL_RESULT=${OVERALL_RESULT}"
  printf "%s" "${OVERALL_RESULT}" > "$SHARED_DIR/OVERALL_RESULT.txt"
  cp "$SHARED_DIR/OVERALL_RESULT.txt" "$ARTIFACT_DIR/reporting/OVERALL_RESULT.txt"
}

# Align this function with the one in https://github.com/openshift/release/blob/master/ci-operator/step-registry/redhat-developer/rhdh/send/alert/redhat-developer-rhdh-send-alert-commands.sh
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
      *auth-providers*)
      part_2="redhat-developer-rhdh-auth-providers-nightly"
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

reportportal_slack_alert() {
  local release_name=$1
  local reportportal_launch_url=$2

  if [[ "$release_name" == *rbac* ]]; then
    RUN_TYPE="rbac-nightly"
  else
    RUN_TYPE="nightly"
  fi
  if [[ ${RESULT} -eq 0 ]]; then
    RUN_STATUS_EMOJI=":done-circle-check:"
    RUN_STATUS="passed"
  else
    RUN_STATUS_EMOJI=":failed:"
    RUN_STATUS="failed"
  fi
  jq -n \
    --arg run_status "$RUN_STATUS" \
    --arg run_type "$RUN_TYPE" \
    --arg reportportal_launch_url "$reportportal_launch_url" \
    --arg job_name "$JOB_NAME" \
    --arg run_status_emoji "$RUN_STATUS_EMOJI" \
    '{
      "RUN_STATUS": $run_status,
      "RUN_TYPE": $run_type,
      "REPORTPORTAL_LAUNCH_URL": $reportportal_launch_url,
      "JOB_NAME": $job_name,
      "RUN_STATUS_EMOJI": $run_status_emoji
    }' > /tmp/data_router_slack_message.json
  if ! curl -X POST -H 'Content-type: application/json' --data @/tmp/data_router_slack_message.json  $SLACK_DATA_ROUTER_WEBHOOK_URL; then
    echo "Failed to send ReportPortal Slack alert"
  else
    echo "ReportPortal Slack alert sent successfully"
  fi
}
