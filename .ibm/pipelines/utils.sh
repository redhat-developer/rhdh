#!/bin/bash

retrieve_pod_logs() {
  local pod_name=$1; local container=$2; local namespace=$3
  echo "  Retrieving logs for container: $container"
  # Save logs for the current and previous container
  kubectl logs $pod_name -c $container -n $namespace > "pod_logs/${pod_name}_${container}.log" || { echo "  logs for container $container not found"; }
  kubectl logs $pod_name -c $container -n $namespace --previous > "pod_logs/${pod_name}_${container}-previous.log" 2>/dev/null || { echo "  Previous logs for container $container not found"; rm -f "pod_logs/${pod_name}_${container}-previous.log"; }
}

save_all_pod_logs(){
  set +e
  local namespace=$1
  namespace=${namespace%-pr-*} # remove -pr- suffix if any.
  mkdir -p pod_logs

  # Get all pod names in the namespace
  pod_names=$(kubectl get pods -n $namespace -o jsonpath='{.items[*].metadata.name}')
  for pod_name in $pod_names; do
    echo "Retrieving logs for pod: $pod_name in namespace $namespace"

    init_containers=$(kubectl get pod $pod_name -n $namespace -o jsonpath='{.spec.initContainers[*].name}')
    # Loop through each init container and retrieve logs
    for init_container in $init_containers; do
      retrieve_pod_logs $pod_name $init_container $namespace
    done
    
    containers=$(kubectl get pod $pod_name -n $namespace -o jsonpath='{.spec.containers[*].name}')
    for container in $containers; do
      retrieve_pod_logs $pod_name $container $namespace
    done
  done

  mkdir -p "${ARTIFACT_DIR}/${namespace}/pod_logs"
  cp -a pod_logs/* "${ARTIFACT_DIR}/${namespace}/pod_logs"
  set -e
}

droute_send() {
  if [[ "${OPENSHIFT_CI}" != "true" ]]; then return 0; fi
  temp_kubeconfig=$(mktemp) # Create temporary KUBECONFIG to open second `oc` session
  ( # Open subshell
    if [ -n "${PULL_NUMBER:-}" ]; then
      set +e
    fi
    export KUBECONFIG="$temp_kubeconfig"
    local droute_version="1.2.2"
    local release_name=$1
    local project=$2
    local droute_project="droute"
    local metadata_output="data_router_metadata_output.json"

    oc login --token="${RHDH_PR_OS_CLUSTER_TOKEN}" --server="${RHDH_PR_OS_CLUSTER_URL}"
    oc whoami --show-server
    local droute_pod_name=$(oc get pods -n droute --no-headers -o custom-columns=":metadata.name" | grep ubi9-cert-rsync)
    local temp_droute=$(oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "mktemp -d")

    JOB_BASE_URL="https://prow.ci.openshift.org/view/gs/test-platform-results"
    if [ -n "${PULL_NUMBER:-}" ]; then
      JOB_URL="${JOB_BASE_URL}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}"
      ARTIFACTS_URL="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}/artifacts/e2e-tests/${REPO_OWNER}-${REPO_NAME}/artifacts/${project}"
    else
      JOB_URL="${JOB_BASE_URL}/logs/${JOB_NAME}/${BUILD_ID}"
      ARTIFACTS_URL="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/${JOB_NAME}/${BUILD_ID}/artifacts/${JOB_NAME##periodic-ci-redhat-developer-rhdh-main-}/${REPO_OWNER}-${REPO_NAME}/artifacts/${project}"
    fi

    # Remove properties (only used for skipped test and invalidates the file if empty)
    sed -i '/<properties>/,/<\/properties>/d' "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}"
    # Replace attachments with link to OpenShift CI storage
    sed -iE "s#\[\[ATTACHMENT|\(.*\)\]\]#${ARTIFACTS_URL}/\1#g" "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}"

    jq \
      --arg hostname "$REPORTPORTAL_HOSTNAME" \
      --arg project "$DATA_ROUTER_PROJECT" \
      --arg name "$JOB_NAME" \
      --arg description "[View job run details](${JOB_URL})" \
      --arg key1 "job_type" \
      --arg value1 "$JOB_TYPE" \
      --arg key2 "pr" \
      --arg value2 "$GIT_PR_NUMBER" \
      --arg key3 "job_name" \
      --arg value3 "$JOB_NAME" \
      --arg key4 "tag_name" \
      --arg value4 "$TAG_NAME" \
      --arg auto_finalization_treshold $DATA_ROUTER_AUTO_FINALIZATION_TRESHOLD \
      '.targets.reportportal.config.hostname = $hostname |
      .targets.reportportal.config.project = $project |
      .targets.reportportal.processing.launch.name = $name |
      .targets.reportportal.processing.launch.description = $description |
      .targets.reportportal.processing.launch.attributes += [
          {"key": $key1, "value": $value1},
          {"key": $key2, "value": $value2},
          {"key": $key3, "value": $value3},
          {"key": $key4, "value": $value4}
        ] |
      .targets.reportportal.processing.tfa.auto_finalization_threshold = ($auto_finalization_treshold | tonumber)
      ' data_router/data_router_metadata_template.json > "${ARTIFACT_DIR}/${project}/${metadata_output}"

    # Send test by rsync to bastion pod.
    local max_attempts=5
    local wait_seconds=4
    for ((i = 1; i <= max_attempts; i++)); do
      echo "Attempt ${i} of ${max_attempts} to rsync test resuls to bastion pod."
      if output=$(oc rsync --progress=true --include="${metadata_output}" --include="${JUNIT_RESULTS}" --exclude="*" -n "${droute_project}" "${ARTIFACT_DIR}/${project}/" "${droute_project}/${droute_pod_name}:${temp_droute}/" 2>&1); then
        echo "$output"
        break
      fi
      if ((i == max_attempts)); then
        echo "Failed to rsync test results after ${max_attempts} attempts."
        echo "Last rsync error details:"
        echo "${output}"
        echo "Troubleshooting steps:"
        echo "1. Restart $droute_pod_name in $droute_project project/namespace"
      fi
    done

    # "Install" Data Router
    oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "
      curl -fsSLk -o ${temp_droute}/droute-linux-amd64 'https://${DATA_ROUTER_NEXUS_HOSTNAME}/nexus/repository/dno-raw/droute-client/${droute_version}/droute-linux-amd64' \
      && chmod +x ${temp_droute}/droute-linux-amd64 \
      && ${temp_droute}/droute-linux-amd64 version"

    # Send test results through DataRouter and save the request ID.
    local max_attempts=5
    local wait_seconds=1
    for ((i = 1; i <= max_attempts; i++)); do
      echo "Attempt ${i} of ${max_attempts} to send test results through Data Router."
      if output=$(oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "
        ${temp_droute}/droute-linux-amd64 send --metadata ${temp_droute}/${metadata_output} \
          --url '${DATA_ROUTER_URL}' \
          --username '${DATA_ROUTER_USERNAME}' \
          --password '${DATA_ROUTER_PASSWORD}' \
          --results '${temp_droute}/${JUNIT_RESULTS}' \
          --verbose" 2>&1) && \
        DATA_ROUTER_REQUEST_ID=$(echo "$output" | grep "request:" | awk '{print $2}') &&
        [ -n "$DATA_ROUTER_REQUEST_ID" ]; then
        echo "Test results successfully sent through Data Router."
        echo "Request ID: $DATA_ROUTER_REQUEST_ID"
        break
      elif ((i == max_attempts)); then
        echo "Failed to send test results after ${max_attempts} attempts."
        echo "Last Data Router error details:"
        echo "${output}"
        echo "Troubleshooting steps:"
        echo "1. Restart $droute_pod_name in $droute_project project/namespace"
        echo "2. Check the Data Router documentation: https://spaces.redhat.com/pages/viewpage.action?pageId=115488042"
        echo "3. Ask for help at Slack: #forum-dno-datarouter"
      fi
    done

    # shellcheck disable=SC2317
    if [[ "$JOB_NAME" == *periodic-* ]]; then
      local max_attempts=30
      local wait_seconds=2
      set +e
      for ((i = 1; i <= max_attempts; i++)); do
        # Get DataRouter request information.
        DATA_ROUTER_REQUEST_OUTPUT=$(oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "
          ${temp_droute}/droute-linux-amd64 request get \
          --url ${DATA_ROUTER_URL} \
          --username ${DATA_ROUTER_USERNAME} \
          --password ${DATA_ROUTER_PASSWORD} \
          ${DATA_ROUTER_REQUEST_ID}")
        # Try to extract the ReportPortal launch URL from the request. This fails if it doesn't contain the launch URL.
        REPORTPORTAL_LAUNCH_URL=$(echo "$DATA_ROUTER_REQUEST_OUTPUT" | yq e '.targets[0].events[] | select(.component == "reportportal-connector") | .message | fromjson | .[0].launch_url' -)
        if [[ -n "$REPORTPORTAL_LAUNCH_URL" ]]; then
          reportportal_slack_alert $release_name $REPORTPORTAL_LAUNCH_URL
          return 0
        else
          echo "Attempt ${i} of ${max_attempts}: ReportPortal launch URL not ready yet."
          sleep "${wait_seconds}"
        fi
      done
      set -e
    fi
    oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "rm -rf ${temp_droute}/*"
    if [ -n "${PULL_NUMBER:-}" ]; then
      set -e
    fi
  ) # Close subshell
  rm -f "$temp_kubeconfig" # Destroy temporary KUBECONFIG
  oc whoami --show-server
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

# Merge the base YAML value file with the differences file for Kubernetes
yq_merge_value_files() {
  local base_file=$1
  local diff_file=$2
  local step_1_file="/tmp/step-without-plugins.yaml"
  local step_2_file="/tmp/step-only-plugins.yaml"
  local final_file=$3
  # Step 1: Merge files, excluding the .global.dynamic.plugins key
  # Values from `diff_file` override those in `base_file`
  yq eval-all '
    select(fileIndex == 0) * select(fileIndex == 1) |
    del(.global.dynamic.plugins)
  ' "${base_file}" "${diff_file}" > "${step_1_file}"
  # Step 2: Merge files, combining the .global.dynamic.plugins key
  # Values from `diff_file` take precedence; plugins are merged and deduplicated by the .package field
  yq eval-all '
    select(fileIndex == 0) *+ select(fileIndex == 1) |
    .global.dynamic.plugins |= (reverse | unique_by(.package) | reverse)
  ' "${base_file}" "${diff_file}" > "${step_2_file}"
  # Step 3: Combine results from the previous steps and remove null values
  # Values from `step_2_file` override those in `step_1_file`
  yq eval-all '
    select(fileIndex == 0) * select(fileIndex == 1) | del(.. | select(. == null))
  ' "${step_2_file}" "${step_1_file}" > "${final_file}"
}

# Waits for a Kubernetes/OpenShift deployment to become ready within a specified timeout period
wait_for_deployment() {
    local namespace=$1
    local resource_name=$2
    local timeout_minutes=${3:-5}  # Default timeout: 5 minutes
    local check_interval=${4:-10}  # Default interval: 10 seconds

    # Validate required parameters
    if [[ -z "$namespace" || -z "$resource_name" ]]; then
        echo "Error: Missing required parameters"
        echo "Usage: wait_for_deployment <namespace> <resource-name> [timeout_minutes] [check_interval_seconds]"
        echo "Example: wait_for_deployment my-namespace my-deployment 5 10"
        return 1
    fi

    local max_attempts=$((timeout_minutes * 60 / check_interval))

    echo "Waiting for resource '$resource_name' in namespace '$namespace' (timeout: ${timeout_minutes}m)..."

    for ((i=1; i<=max_attempts; i++)); do
        # Get the first pod name matching the resource name
        local pod_name=$(oc get pods -n "$namespace" | grep "$resource_name" | awk '{print $1}' | head -n 1)

        if [[ -n "$pod_name" ]]; then
            # Check if pod's Ready condition is True
            local is_ready=$(oc get pod "$pod_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
            # Verify pod is both Ready and Running
            if [[ "$is_ready" == "True" ]] && \
               oc get pod "$pod_name" -n "$namespace" | grep -q "Running"; then
                echo "Pod '$pod_name' is running and ready"
                return 0
            else
                echo "Pod '$pod_name' is not ready (Ready: $is_ready)"
            fi
        else
            echo "No pods found matching '$resource_name' in namespace '$namespace'"
        fi

        echo "Still waiting... (${i}/${max_attempts} checks)"
        sleep "$check_interval"
    done

    # Timeout occurred
    echo "Timeout waiting for resource to be ready. Please check:"
    echo "oc get pods -n $namespace | grep $resource_name"
    return 1
}

# Creates an OpenShift Operator subscription
install_subscription(){
  name=$1  # Name of the subscription
  namespace=$2 # Namespace to install the operator
  package=$3 # Package name of the operator
  channel=$4 # Channel to subscribe to
  source_name=$5 # Name of the source catalog
  # Apply the subscription manifest
  oc apply -f - << EOD
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: $name
  namespace: $namespace
spec:
  channel: $channel
  installPlanApproval: Automatic
  name: $package
  source: $source_name
  sourceNamespace: openshift-marketplace
EOD
}

# Installs the Crunchy Postgres Operator using predefined parameters
install_crunchy_postgres_operator(){
  install_subscription crunchy-postgres-operator openshift-operators crunchy-postgres-operator v5 certified-operators
}

# Installs the Red Hat OpenShift Pipelines operator if not already installed
install_pipelines_operator() {
  DISPLAY_NAME="Red Hat OpenShift Pipelines"
  # Check if operator is already installed
  if oc get csv -n "openshift-operators" | grep -q "${DISPLAY_NAME}"; then
    echo "Red Hat OpenShift Pipelines operator is already installed."
  else
    echo "Red Hat OpenShift Pipelines operator is not installed. Installing..."
    # Install the operator and wait for deployment
    install_subscription openshift-pipelines-operator openshift-operators openshift-pipelines-operator-rh latest redhat-operators
    wait_for_deployment "openshift-operators" "pipelines"
  fi
}
