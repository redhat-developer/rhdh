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
  rm -rf pod_logs && mkdir -p pod_logs

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

    oc rsync --progress=true --include="${metadata_output}" --include="${JUNIT_RESULTS}" --exclude="*" -n "${droute_project}" "${ARTIFACT_DIR}/${project}/" "${droute_project}/${droute_pod_name}:${temp_droute}/"

    # "Install" Data Router
    oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "
      curl -fsSLk -o /tmp/droute-linux-amd64 'https://${DATA_ROUTER_NEXUS_HOSTNAME}/nexus/repository/dno-raw/droute-client/${droute_version}/droute-linux-amd64' \
      && chmod +x /tmp/droute-linux-amd64 \
      && /tmp/droute-linux-amd64 version"

    # Send test results through DataRouter and save the request ID.
    local max_attempts=5
    local wait_seconds=1
    for ((i = 1; i <= max_attempts; i++)); do
      echo "Attempt ${i} of ${max_attempts} to send test results through Data Router."
      if output=$(oc exec -n "${droute_project}" "${droute_pod_name}" -- /bin/bash -c "
        /tmp/droute-linux-amd64 send --metadata ${temp_droute}/${metadata_output} \
        --url '${DATA_ROUTER_URL}' \
        --username '${DATA_ROUTER_USERNAME}' \
        --password '${DATA_ROUTER_PASSWORD}' \
        --results '${temp_droute}/${JUNIT_RESULTS}' \
        --verbose" 2>&1); then
        if DATA_ROUTER_REQUEST_ID=$(echo "$output" | grep "request:" | awk '{print $2}') &&
          [ -n "$DATA_ROUTER_REQUEST_ID" ]; then
          echo "Test results successfully sent through Data Router."
          echo "Request ID: $DATA_ROUTER_REQUEST_ID"
          break
        fi
      fi

      if ((i == max_attempts)); then
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
          /tmp/droute-linux-amd64 request get \
          --url ${DATA_ROUTER_URL} \
          --username ${DATA_ROUTER_USERNAME} \
          --password ${DATA_ROUTER_PASSWORD} \
          ${DATA_ROUTER_REQUEST_ID}")
        # Try to extract the ReportPortal launch URL from the request. This fails if it doesn't contain the launch URL.
        REPORTPORTAL_LAUNCH_URL=$(echo "$DATA_ROUTER_REQUEST_OUTPUT" | yq e '.targets[0].events[] | select(.component == "reportportal-connector") | .message | fromjson | .[0].launch_url' -)
        if [[ $? -eq 0 ]]; then
          if [[ "$release_name" == *rbac* ]]; then
            RUN_TYPE="rbac-nightly"
          else
            RUN_TYPE="nightly"
          fi
          if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
            RUN_STATUS_EMOJI=":done-circle-check:"
            RUN_STATUS="passed"
          else
            RUN_STATUS_EMOJI=":failed:"
            RUN_STATUS="failed"
          fi
          jq -n \
            --arg run_status "$RUN_STATUS" \
            --arg run_type "$RUN_TYPE" \
            --arg reportportal_launch_url "$REPORTPORTAL_LAUNCH_URL" \
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

wait_for_svc(){
  local svc_name=$1
  local namespace=$2
  local timeout=${3:-300}
  
  timeout "${timeout}" bash -c "
    echo ${svc_name}
    while ! oc get svc $svc_name -n $namespace &> /dev/null; do
      echo \"Waiting for ${svc_name} service to be created...\"
      sleep 5
    done
    echo \"Service ${svc_name} is created.\"
    " || echo "Error: Timed out waiting for $svc_name service creation."
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

# Monitors the status of an operator in an OpenShift namespace.
# It checks the ClusterServiceVersion (CSV) for a specific operator to verify if its phase matches an expected value.
check_operator_status() {
  local timeout=${1:-300} # Timeout in seconds (default 300)
  local namespace=$2 # Namespace to check
  local operator_name=$3 # Operator name
  local expected_status=${4:-"Succeeded"} # Expected status phase (default Succeeded)

  echo "Checking the status of operator '${operator_name}' in namespace '${namespace}' with a timeout of ${timeout} seconds."
  echo "Expected status: ${expected_status}"

  timeout "${timeout}" bash -c "
    while true; do
      CURRENT_PHASE=\$(oc get csv -n '${namespace}' -o jsonpath='{.items[?(@.spec.displayName==\"${operator_name}\")].status.phase}')
      echo \"Operator '${operator_name}' current phase: \${CURRENT_PHASE}\"
      [[ \"\${CURRENT_PHASE}\" == \"${expected_status}\" ]] && echo \"Operator '${operator_name}' is now in '${expected_status}' phase.\" && break
      sleep 10
    done
  " || echo "Timed out after ${timeout} seconds. Operator '${operator_name}' did not reach '${expected_status}' phase."
}

# Installs the Crunchy Postgres Operator using predefined parameters
install_crunchy_postgres_operator(){
  install_subscription crunchy-postgres-operator openshift-operators crunchy-postgres-operator v5 certified-operators
  check_operator_status 300 "openshift-operators" "Crunchy Postgres for Kubernetes" "Succeeded"
}

add_helm_repos() {
  helm version

  local repos=(
    "bitnami=https://charts.bitnami.com/bitnami"
    "backstage=https://backstage.github.io/charts"
    "${HELM_REPO_NAME}=${HELM_REPO_URL}"
  )

  for repo in "${repos[@]}"; do
    local key="${repo%%=*}"
    local value="${repo##*=}"

    if ! helm repo list | grep -q "^$key"; then
      helm repo add "$key" "$value"
    else
      echo "Repository $key already exists - updating repository instead."
    fi
  done

  helm repo update
}

uninstall_helmchart() {
  local project=$1
  local release=$2
  if helm list -n "${project}" | grep -q "${release}"; then
    echo "Chart already exists. Removing it before install."
    helm uninstall "${release}" -n "${project}"
  fi
}

configure_namespace() {
  local project=$1
  echo "Deleting and recreating namespace: $project"
  delete_namespace $project

  if ! oc create namespace "${project}"; then
      echo "Error: Failed to create namespace ${project}" >&2
      exit 1
  fi
  if ! oc config set-context --current --namespace="${project}"; then
      echo "Error: Failed to set context for namespace ${project}" >&2
      exit 1
  fi

  echo "Namespace ${project} is ready."
}

delete_namespace() {
  local project=$1
  if oc get namespace "$project" >/dev/null 2>&1; then
    echo "Namespace ${project} exists. Attempting to delete..."

    # Remove blocking finalizers
    # remove_finalizers_from_resources "$project"

    # Attempt to delete the namespace
    oc delete namespace "$project" --grace-period=0 --force || true

    # Check if namespace is still stuck in 'Terminating' and force removal if necessary
    if oc get namespace "$project" -o jsonpath='{.status.phase}' | grep -q 'Terminating'; then
      echo "Namespace ${project} is stuck in Terminating. Forcing deletion..."
      force_delete_namespace "$project"
    fi
  fi
}

configure_external_postgres_db() {
  local project=$1
  oc apply -f "${DIR}/resources/postgres-db/postgres.yaml" --namespace="${NAME_SPACE_POSTGRES_DB}"
  sleep 5

  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.ca\.crt}' | base64 --decode > postgres-ca
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.crt}' | base64 --decode > postgres-tls-crt
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.key}' | base64 --decode > postgres-tsl-key

  oc create secret generic postgress-external-db-cluster-cert \
  --from-file=ca.crt=postgres-ca \
  --from-file=tls.crt=postgres-tls-crt \
  --from-file=tls.key=postgres-tsl-key \
  --dry-run=client -o yaml | oc apply -f - --namespace="${project}"

  POSTGRES_PASSWORD=$(oc get secret/postgress-external-db-pguser-janus-idp -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath={.data.password})
  sed -i "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  POSTGRES_HOST=$(echo -n "postgress-external-db-primary.$NAME_SPACE_POSTGRES_DB.svc.cluster.local" | base64 | tr -d '\n')
  sed -i "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${POSTGRES_HOST}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "${DIR}/resources/postgres-db/postgres-cred.yaml"  --namespace="${project}"
}

apply_yaml_files() {
  local dir=$1
  local project=$2
  local rhdh_base_url=$3
  echo "Applying YAML files to namespace ${project}"

  oc config set-context --current --namespace="${project}"

  local files=(
      "$dir/resources/service_account/service-account-rhdh.yaml"
      "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml"
      "$dir/resources/cluster_role/cluster-role-k8s.yaml"
      "$dir/resources/cluster_role/cluster-role-ocm.yaml"
      "$dir/auth/secrets-rhdh-secrets.yaml"
    )

    for file in "${files[@]}"; do
      sed -i "s/namespace:.*/namespace: ${project}/g" "$file"
    done

    DH_TARGET_URL=$(echo -n "test-backstage-customization-provider-${project}.${K8S_CLUSTER_ROUTER_BASE}" | base64 -w 0)
    local RHDH_BASE_URL=$(echo -n "$rhdh_base_url" | base64 | tr -d '\n')

    for key in GITHUB_APP_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_PRIVATE_KEY GITHUB_APP_CLIENT_SECRET GITHUB_APP_JANUS_TEST_APP_ID GITHUB_APP_JANUS_TEST_CLIENT_ID GITHUB_APP_JANUS_TEST_CLIENT_SECRET GITHUB_APP_JANUS_TEST_PRIVATE_KEY GITHUB_APP_WEBHOOK_URL GITHUB_APP_WEBHOOK_SECRET KEYCLOAK_CLIENT_SECRET ACR_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET K8S_CLUSTER_TOKEN_ENCODED OCM_CLUSTER_URL GITLAB_TOKEN KEYCLOAK_AUTH_BASE_URL KEYCLOAK_AUTH_CLIENTID KEYCLOAK_AUTH_CLIENT_SECRET KEYCLOAK_AUTH_LOGIN_REALM KEYCLOAK_AUTH_REALM RHDH_BASE_URL DH_TARGET_URL; do
      sed -i "s|${key}:.*|${key}: ${!key}|g" "$dir/auth/secrets-rhdh-secrets.yaml"
    done

    oc apply -f "$dir/resources/service_account/service-account-rhdh.yaml" --namespace="${project}"
    oc apply -f "$dir/auth/service-account-rhdh-secret.yaml" --namespace="${project}"
    oc apply -f "$dir/auth/secrets-rhdh-secrets.yaml" --namespace="${project}"

    oc apply -f "$dir/resources/cluster_role/cluster-role-k8s.yaml" --namespace="${project}"
    oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml" --namespace="${project}"
    oc apply -f "$dir/resources/cluster_role/cluster-role-ocm.yaml" --namespace="${project}"
    oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-ocm.yaml" --namespace="${project}"

    sed -i "s/K8S_CLUSTER_API_SERVER_URL:.*/K8S_CLUSTER_API_SERVER_URL: ${K8S_CLUSTER_API_SERVER_URL}/g" "$dir/auth/secrets-rhdh-secrets.yaml"

    sed -i "s/K8S_CLUSTER_NAME:.*/K8S_CLUSTER_NAME: ${ENCODED_CLUSTER_NAME}/g" "$dir/auth/secrets-rhdh-secrets.yaml"

    token=$(oc get secret rhdh-k8s-plugin-secret -n "${project}" -o=jsonpath='{.data.token}')
    sed -i "s/OCM_CLUSTER_TOKEN: .*/OCM_CLUSTER_TOKEN: ${token}/" "$dir/auth/secrets-rhdh-secrets.yaml"

    # Select the configuration file based on the namespace or job
    config_file=$(select_config_map_file)
    # Apply the ConfigMap with the correct file
    if [[ "${project}" == *showcase-k8s* ]]; then # Specific to non-RBAC deployment on K8S
      create_app_config_map_k8s "$config_file" "$project"
    else
      create_app_config_map "$config_file" "$project"
    fi
    oc create configmap dynamic-homepage-and-sidebar-config \
      --from-file="dynamic-homepage-and-sidebar-config.yaml"="$dir/resources/config_map/dynamic-homepage-and-sidebar-config.yaml" \
      --namespace="${project}" \
      --dry-run=client -o yaml | oc apply -f -

    if [[ "${project}" == *showcase-op* ]]; then
      oc create configmap rbac-policy \
        --from-file="rbac-policy.csv"="$dir/resources/config_map/rbac-policy.csv" \
        --from-file="conditional-policies.yaml"="/tmp/conditional-policies.yaml" \
        --namespace="$project" \
        --dry-run=client -o yaml | oc apply -f -
    else
      oc create configmap rbac-policy \
        --from-file="rbac-policy.csv"="$dir/resources/config_map/rbac-policy.csv" \
        --namespace="$project" \
        --dry-run=client -o yaml | oc apply -f -
    fi

    oc apply -f "$dir/auth/secrets-rhdh-secrets.yaml" --namespace="${project}"

    # Create Pipeline run for tekton test case.
    oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline.yaml"
    oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline-run.yaml"

    # Create Deployment and Pipeline for Topology test.
    oc apply -f "$dir/resources/topology_test/topology-test.yaml"
    if [[ "${project}" == *k8s* ]]; then
      oc apply -f "$dir/resources/topology_test/topology-test-ingress.yaml"
    else
      oc apply -f "$dir/resources/topology_test/topology-test-route.yaml"
    fi
}

deploy_test_backstage_provider() {
  local project=$1
  echo "Deploying test-backstage-customization-provider in namespace ${project}"

  # Check if the buildconfig already exists
  if ! oc get buildconfig test-backstage-customization-provider -n "${project}" >/dev/null 2>&1; then
    echo "Creating new app for test-backstage-customization-provider"
    oc new-app https://github.com/janus-qe/test-backstage-customization-provider --image-stream="openshift/nodejs:18-minimal-ubi8" --namespace="${project}"
  else
    echo "BuildConfig for test-backstage-customization-provider already exists in ${project}. Skipping new-app creation."
  fi

  echo "Exposing service for test-backstage-customization-provider"
  oc expose svc/test-backstage-customization-provider --namespace="${project}"
}

create_app_config_map() {
  local config_file=$1
  local project=$2

  oc create configmap app-config-rhdh \
    --from-file="app-config-rhdh.yaml"="$config_file" \
    --namespace="$project" \
    --dry-run=client -o yaml | oc apply -f -
}

select_config_map_file() {
  if [[ "${project}" == *rbac* ]]; then
    echo "$dir/resources/config_map/app-config-rhdh-rbac.yaml"
  else
    echo "$dir/resources/config_map/app-config-rhdh.yaml"
  fi
}



create_dynamic_plugins_config() {
  local base_file=$1
  local final_file=$2
  echo "kind: ConfigMap
apiVersion: v1
metadata:
  name: dynamic-plugins
data:
  dynamic-plugins.yaml: |" >> ${final_file}
  yq '.global.dynamic' ${base_file} | sed -e 's/^/    /' >> ${final_file}
}

create_conditional_policies_operator() {
  local destination_file=$1
  yq '.upstream.backstage.initContainers[0].command[2]' "${DIR}/value_files/values_showcase-rbac.yaml" | head -n -4 | tail -n +2 > $destination_file
  sed -i 's/\\\$/\$/g' $destination_file
}

prepare_operator_app_config() {
  local config_file=$1
  yq e -i '.permission.rbac.conditionalPoliciesFile = "./rbac/conditional-policies.yaml"' ${config_file}
}

create_app_config_map_k8s() {
    local config_file=$1
    local project=$2

    echo "Creating k8s-specific app-config ConfigMap in namespace ${project}"

    yq 'del(.backend.cache)' "$config_file" \
    | oc create configmap app-config-rhdh \
        --from-file="app-config-rhdh.yaml"="/dev/stdin" \
        --namespace="${project}" \
        --dry-run=client -o yaml \
    | oc apply -f -
}

run_tests() {
  local release_name=$1
  local project=$2
  project=${project}
  cd "${DIR}/../../e2e-tests"
  local e2e_tests_dir
  e2e_tests_dir=$(pwd)

  yarn install
  yarn playwright install chromium

  Xvfb :99 &
  export DISPLAY=:99

  (
    set -e
    echo "Using PR container image: ${TAG_NAME}"
    yarn "$project"
  ) 2>&1 | tee "/tmp/${LOGFILE}"

  local RESULT=${PIPESTATUS[0]}

  pkill Xvfb

  mkdir -p "${ARTIFACT_DIR}/${project}/test-results"
  mkdir -p "${ARTIFACT_DIR}/${project}/attachments/screenshots"
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${project}/test-results"
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}"

  if [ -d "${e2e_tests_dir}/screenshots" ]; then
    cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${project}/attachments/screenshots/"
  fi

  if [ -d "${e2e_tests_dir}/auth-providers-logs" ]; then
    cp -a "${e2e_tests_dir}/auth-providers-logs/"* "${ARTIFACT_DIR}/${project}/"
  fi

  ansi2html <"/tmp/${LOGFILE}" >"/tmp/${LOGFILE}.html"
  cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${project}"
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${project}"

  droute_send "${release_name}" "${project}"

  echo "${project} RESULT: ${RESULT}"
  if [ "${RESULT}" -ne 0 ]; then
    OVERALL_RESULT=1
  fi
}

check_backstage_running() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=$4
  local wait_seconds=$5

  echo "Checking if Backstage is up and running at ${url}"

  trap cleanup EXIT INT ERR # reapply trap

  for ((i = 1; i <= max_attempts; i++)); do
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}")

    if [ "${http_status}" -eq 200 ]; then
      echo "Backstage is up and running!"
      export BASE_URL="${url}"
      echo "######## BASE URL ########"
      echo "${BASE_URL}"
      return 0
    else
      echo "Attempt ${i} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
      oc get pods -n "${namespace}"
      sleep "${wait_seconds}"
    fi
  done

  echo "Failed to reach Backstage at ${BASE_URL} after ${max_attempts} attempts." | tee -a "/tmp/${LOGFILE}"
  cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/"
  return 1
}

# installs the advanced-cluster-management Operator
install_acm_operator(){
  oc apply -f "${DIR}/cluster/operators/acm/operator-group.yaml"
  oc apply -f "${DIR}/cluster/operators/acm/subscription-acm.yaml"
  wait_for_deployment "open-cluster-management" "multiclusterhub-operator"
  wait_for_svc multiclusterhub-operator-webhook open-cluster-management
  oc apply -f "${DIR}/cluster/operators/acm/multiclusterhub.yaml"
  # wait until multiclusterhub is Running.
  timeout 900 bash -c 'while true; do 
    CURRENT_PHASE=$(oc get multiclusterhub multiclusterhub -n open-cluster-management -o jsonpath="{.status.phase}")
    echo "MulticlusterHub Current Status: $CURRENT_PHASE"
    [[ "$CURRENT_PHASE" == "Running" ]] && echo "MulticlusterHub is now in Running phase." && break
    sleep 10
  done' || echo "Timed out after 15 minutes"

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
    timeout 300 bash -c '
    while ! oc get svc tekton-pipelines-webhook -n openshift-pipelines &> /dev/null; do
        echo "Waiting for tekton-pipelines-webhook service to be created..."
        sleep 5
    done
    echo "Service tekton-pipelines-webhook is created."
    ' || echo "Error: Timed out waiting for tekton-pipelines-webhook service creation."
  fi
}

# Installs the Tekton Pipelines if not already installed (alternative of OpenShift Pipelines for Kubernetes clusters)
install_tekton_pipelines() {
  DISPLAY_NAME="tekton-pipelines-webhook"
  if oc get pods -n "tekton-pipelines" | grep -q "${DISPLAY_NAME}"; then
    echo "Tekton Pipelines are already installed."
  else
    echo "Tekton Pipelines is not installed. Installing..."
    kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
    wait_for_deployment "tekton-pipelines" "${DISPLAY_NAME}"
    timeout 300 bash -c '
    while ! kubectl get endpoints tekton-pipelines-webhook -n tekton-pipelines &> /dev/null; do
        echo "Waiting for tekton-pipelines-webhook endpoints to be ready..."
        sleep 5
    done
    echo "Endpoints for tekton-pipelines-webhook are ready."
    ' || echo "Error: Timed out waiting for tekton-pipelines-webhook endpoints."
  fi
}

delete_tekton_pipelines() {
    echo "Checking for Tekton Pipelines installation..."
    # Check if tekton-pipelines namespace exists
    if kubectl get namespace tekton-pipelines &> /dev/null; then
        echo "Found Tekton Pipelines installation. Attempting to delete..."
        # Delete the resources and ignore errors
        kubectl delete -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml --ignore-not-found=true 2>/dev/null || true
        # Wait for namespace deletion (with timeout)
        echo "Waiting for Tekton Pipelines namespace to be deleted..."
        timeout 30 bash -c '
        while kubectl get namespace tekton-pipelines &> /dev/null; do
            echo "Waiting for tekton-pipelines namespace deletion..."
            sleep 5
        done
        echo "Tekton Pipelines deleted successfully."
        ' || echo "Warning: Timed out waiting for namespace deletion, continuing..."
    else
        echo "Tekton Pipelines is not installed. Nothing to delete."
    fi
}

cluster_setup() {
  install_pipelines_operator
  install_acm_operator
  install_crunchy_postgres_operator
  add_helm_repos
}

cluster_setup_operator() {
  install_pipelines_operator
  install_acm_operator
  install_crunchy_postgres_operator
}

initiate_deployments() {
  configure_namespace ${NAME_SPACE}

  # Deploy redis cache db.
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE}"

  cd "${DIR}"
  local rhdh_base_url="https://${RELEASE_NAME}-backstage-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
    -f "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}"

  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  # Initiate rbac instance deployment.
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-backstage-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
    "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
    -f "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}"
}

initiate_rds_deployment() {
  local release_name=$1
  local namespace=$2
  configure_namespace "${namespace}"
  uninstall_helmchart "${namespace}" "${release_name}"
  sed -i "s|POSTGRES_USER:.*|POSTGRES_USER: $RDS_USER|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: $(echo -n $RDS_PASSWORD | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_HOST:.*|POSTGRES_HOST: $(echo -n $RDS_1_HOST | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "$DIR/resources/postgres-db/postgres-crt-rds.yaml" -n "${namespace}"
  oc apply -f "$DIR/resources/postgres-db/postgres-cred.yaml" -n "${namespace}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${namespace}"
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" \
    -f "$DIR/resources/postgres-db/values-showcase-postgres.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}"
}

check_and_test() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30}    # Default to 30 if not set
  local wait_seconds=${5:-30}    # Default to 30 if not set
  if check_backstage_running "${release_name}" "${namespace}" "${url}" "${max_attempts}" "${wait_seconds}"; then
    echo "Display pods for verification..."
    oc get pods -n "${namespace}"
    run_tests "${release_name}" "${namespace}"
  else
    echo "Backstage is not running. Exiting..."
    OVERALL_RESULT=1
  fi
  save_all_pod_logs $namespace
}

# Function to remove finalizers from specific resources in a namespace that are blocking deletion.
remove_finalizers_from_resources() {
  local project=$1
  echo "Removing finalizers from resources in namespace ${project} that are blocking deletion."

  # Remove finalizers from stuck PipelineRuns and TaskRuns
  for resource_type in "pipelineruns.tekton.dev" "taskruns.tekton.dev"; do
    for resource in $(oc get "$resource_type" -n "$project" -o name); do
      oc patch "$resource" -n "$project" --type='merge' -p '{"metadata":{"finalizers":[]}}' || true
      echo "Removed finalizers from $resource in $project."
    done
  done

  # Check and remove specific finalizers stuck on 'chains.tekton.dev' resources
  for chain_resource in $(oc get pipelineruns.tekton.dev,taskruns.tekton.dev -n "$project" -o name); do
    oc patch "$chain_resource" -n "$project" --type='json' -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
    echo "Removed Tekton finalizers from $chain_resource in $project."
  done
}

# Function to forcibly delete a namespace stuck in 'Terminating' status
force_delete_namespace() {
  local project=$1
  echo "Forcefully deleting namespace ${project}."
  oc get namespace "$project" -o json | jq '.spec = {"finalizers":[]}' | oc replace --raw "/api/v1/namespaces/$project/finalize" -f -
}

oc_login() {
  oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true
  echo "OCP version: $(oc version)"
  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
}
