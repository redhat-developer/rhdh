#!/bin/bash

save_status_deployment_namespace() {
  local current_deployment=$1
  local current_namespace=$2
  STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]="${current_namespace}"
  printf "%s\n" "${STATUS_DEPLOYMENT_NAMESPACE["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt"
}

save_status_failed_to_deploy() {
  local current_deployment=$1
  local status=$2
  STATUS_FAILED_TO_DEPLOY["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_FAILED_TO_DEPLOY["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt"
}

save_status_test_failed() {
  local current_deployment=$1
  local status=$2
  STATUS_TEST_FAILED["${current_deployment}"]="${status}"
  printf "%s\n" "${STATUS_TEST_FAILED["${current_deployment}"]}" >> "$SHARED_DIR/STATUS_TEST_FAILED.txt"
}

get_artifacts_url() {
  local project="${1:-""}"

  local artifacts_base_url="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results"
  local artifacts_complete_url
  if [ -n "${PULL_NUMBER:-}" ]; then
    artifacts_complete_url="${artifacts_base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}/artifacts/e2e-tests/${REPO_OWNER}-${REPO_NAME}/artifacts/${project}"
  else
    local part_1="${JOB_NAME##periodic-ci-redhat-developer-rhdh-"${RELEASE_BRANCH_NAME}"-}"
    local part_2="${REPO_OWNER}-${REPO_NAME}-${JOB_NAME##periodic-ci-redhat-developer-rhdh-"${RELEASE_BRANCH_NAME}"-e2e-tests-}"
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

report_ci_slack_alert() {
  set -x
  URL_CI_RESULTS=$(get_job_url)
  local notification_text
  if [[ $OVERALL_RESULT == 0 ]]; then
    notification_text=":done-circle-check: \`${JOB_NAME}\`, 📜 <$URL_CI_RESULTS|logs>."
  else
    notification_text=':failed: `'"${JOB_NAME}"'`, 📜 <'"$URL_CI_RESULTS"'|logs>, <!subteam^S07BMJ56R8S>.'
    for ((i = 1; i <= ${#STATUS_DEPLOYMENT_NAMESPACE[@]}; i++)); do
      URL_ARTIFACTS[i]=$(get_artifacts_url "${STATUS_DEPLOYMENT_NAMESPACE[i]}")
      URL_PLAYWRIGHT[i]="${URL_ARTIFACTS[i]}/index.html"
      if [[ "${STATUS_FAILED_TO_DEPLOY[i]}" == "true" ]]; then
        notification_text="${notification_text}\n• \`${STATUS_DEPLOYMENT_NAMESPACE[i]}\` :circleci-fail: failed to deploy, "
      else
        notification_text="${notification_text}\n• \`${STATUS_DEPLOYMENT_NAMESPACE[i]}\` :deployments: deployed, "
        if [[ "${STATUS_TEST_FAILED[i]}" == "true" ]]; then
          notification_text="${notification_text}:circleci-fail: test failed, "
        else
          notification_text="${notification_text}:circleci-pass: test passed, "
        fi
        notification_text="${notification_text}:playwright: <${URL_PLAYWRIGHT[i]}|Playwright>, "
        if [[ "${URL_REPORTPORTAL[i]}" != "" ]]; then
          notification_text="${notification_text}:reportportal: <${URL_REPORTPORTAL[i]}|ReportPortal>, "
        fi
      fi
      notification_text="${notification_text}📦 <${URL_ARTIFACTS[i]}|artifacts>."
    done
  fi
  set +x

  echo "${notification_text}"
  printf "%s" "${notification_text}"
  echo "Saving the notification text to a file, which is then picked up by a separate CI step."
  # It is important to save the file in the shared directory with the exact name.
  echo "${notification_text}" > "${SHARED_DIR}/ci-slack-alert.txt"

  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"${notification_text}\"}" \
    "$SLACK_NIGHTLY_WEBHOOK_URL"
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
  curl -X POST -H 'Content-type: application/json' --data @/tmp/data_router_slack_message.json  $SLACK_DATA_ROUTER_WEBHOOK_URL
}
