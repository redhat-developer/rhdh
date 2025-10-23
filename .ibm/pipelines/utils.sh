#!/bin/bash

# shellcheck source=.ibm/pipelines/reporting.sh
source "${DIR}/reporting.sh"

retrieve_pod_logs() {
  local pod_name=$1
  local container=$2
  local namespace=$3
  echo "  Retrieving logs for container: $container"
  # Save logs for the current and previous container
  kubectl logs $pod_name -c $container -n $namespace > "pod_logs/${pod_name}_${container}.log" || { echo "  logs for container $container not found"; }
  kubectl logs $pod_name -c $container -n $namespace --previous > "pod_logs/${pod_name}_${container}-previous.log" 2> /dev/null || {
    echo "  Previous logs for container $container not found"
    rm -f "pod_logs/${pod_name}_${container}-previous.log"
  }
}

save_all_pod_logs() {
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
  cp -a pod_logs/* "${ARTIFACT_DIR}/${namespace}/pod_logs" || true
  set -e
}

# Merge the base YAML value file with the differences file for Kubernetes
yq_merge_value_files() {
  local plugin_operation=$1 # Chose whether you want to merge or overwrite the plugins key (the second file will overwrite the first)
  local base_file=$2
  local diff_file=$3
  local step_1_file="/tmp/step-without-plugins.yaml"
  local step_2_file="/tmp/step-only-plugins.yaml"
  local final_file=$4
  if [ "$plugin_operation" = "merge" ]; then
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
  elif [ "$plugin_operation" = "overwrite" ]; then
    yq eval-all '
    select(fileIndex == 0) * select(fileIndex == 1)
  ' "${base_file}" "${diff_file}" > "${final_file}"
  else
    echo "Invalid operation with plugins key: $plugin_operation"
    exit 1
  fi
}

# Waits for a Kubernetes/OpenShift deployment to become ready within a specified timeout period
wait_for_deployment() {
  local namespace=$1
  local resource_name=$2
  local timeout_minutes=${3:-5} # Default timeout: 5 minutes
  local check_interval=${4:-10} # Default interval: 10 seconds

  # Validate required parameters
  if [[ -z "$namespace" || -z "$resource_name" ]]; then
    echo "Error: Missing required parameters"
    echo "Usage: wait_for_deployment <namespace> <resource-name> [timeout_minutes] [check_interval_seconds]"
    echo "Example: wait_for_deployment my-namespace my-deployment 5 10"
    return 1
  fi

  local max_attempts=$((timeout_minutes * 60 / check_interval))

  echo "Waiting for resource '$resource_name' in namespace '$namespace' (timeout: ${timeout_minutes}m)..."

  for ((i = 1; i <= max_attempts; i++)); do
    # Get the first pod name matching the resource name
    local pod_name
    pod_name=$(oc get pods -n "$namespace" | grep "$resource_name" | awk '{print $1}' | head -n 1)

    if [[ -n "$pod_name" ]]; then
      # Check if pod's Ready condition is True
      local is_ready
      is_ready=$(oc get pod "$pod_name" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
      # Verify pod is both Ready and Running
      if [[ "$is_ready" == "True" ]] \
        && oc get pod "$pod_name" -n "$namespace" | grep -q "Running"; then
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

wait_for_svc() {
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

wait_for_endpoint() {
  local endpoint_name=$1
  local namespace=$2
  local timeout=${3:-500}

  timeout "${timeout}" bash -c "
    echo ${endpoint_name}
    while ! kubectl get endpoints $endpoint_name -n $namespace &> /dev/null; do
      echo \"Waiting for ${endpoint_name} endpoint to be created...\"
      sleep 5
    done
    echo \"Endpoint ${endpoint_name} is created.\"
    " || echo "Error: Timed out waiting for $endpoint_name endpoint creation."
}

# Creates an OpenShift Operator subscription
install_subscription() {
  name=$1             # Name of the subscription
  namespace=$2        # Namespace to install the operator
  channel=$3          # Channel to subscribe to
  package=$4          # Package name of the operator
  source_name=$5      # Name of the source catalog
  source_namespace=$6 # Source namespace (typically openshift-marketplace or olm)
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
  sourceNamespace: $source_namespace
EOD
}

create_secret_dockerconfigjson() {
  namespace=$1
  secret_name=$2
  dockerconfigjson_value=$3
  echo "Creating dockerconfigjson secret $secret_name in namespace $namespace"
  kubectl apply -n "$namespace" -f - << EOD
apiVersion: v1
kind: Secret
metadata:
  name: $secret_name
data:
  .dockerconfigjson: $dockerconfigjson_value
type: kubernetes.io/dockerconfigjson
EOD
}
add_image_pull_secret_to_namespace_default_serviceaccount() {
  namespace=$1
  secret_name=$2
  echo "Adding image pull secret $secret_name to default service account"
  kubectl -n "${namespace}" patch serviceaccount default -p "{\"imagePullSecrets\": [{\"name\": \"${secret_name}\"}]}"
}
setup_image_pull_secret() {
  local namespace=$1
  local secret_name=$2
  local dockerconfigjson_value=$3
  echo "Creating $secret_name secret in $namespace namespace"
  create_secret_dockerconfigjson "$namespace" "$secret_name" "$dockerconfigjson_value"
  add_image_pull_secret_to_namespace_default_serviceaccount "$namespace" "$secret_name"
}

# Monitors the status of an operator in an OpenShift namespace.
# It checks the ClusterServiceVersion (CSV) for a specific operator to verify if its phase matches an expected value.
check_operator_status() {
  local timeout=${1:-300}                 # Timeout in seconds (default 300)
  local namespace=$2                      # Namespace to check
  local operator_name=$3                  # Operator name
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

# Installs the Crunchy Postgres Operator from Openshift Marketplace using predefined parameters
install_crunchy_postgres_ocp_operator() {
  install_subscription postgresql openshift-operators v5 postgresql community-operators openshift-marketplace
  check_operator_status 300 "openshift-operators" "Crunchy Postgres for Kubernetes" "Succeeded"
}

# Installs the Crunchy Postgres Operator from OperatorHub.io
install_crunchy_postgres_k8s_operator() {
  install_subscription postgresql openshift-operators v5 postgresql community-operators openshift-marketplace
  check_operator_status 300 "operators" "Crunchy Postgres for Kubernetes" "Succeeded"
}

# Installs the OpenShift Serverless Logic Operator (SonataFlow) from OpenShift Marketplace
install_serverless_logic_ocp_operator() {
  install_subscription logic-operator-rhel8 openshift-operators alpha logic-operator-rhel8 redhat-operators openshift-marketplace
  check_operator_status 300 "openshift-operators" "OpenShift Serverless Logic Operator" "Succeeded"
}

# Installs the OpenShift Serverless Operator (Knative) from OpenShift Marketplace
install_serverless_ocp_operator() {
  install_subscription serverless-operator openshift-operators stable serverless-operator redhat-operators openshift-marketplace
  check_operator_status 300 "openshift-operators" "Red Hat OpenShift Serverless" "Succeeded"
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
  if oc get namespace "$project" > /dev/null 2>&1; then
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

  POSTGRES_PASSWORD=$(oc get secret/postgress-external-db-pguser-janus-idp -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.password}')
  sed_inplace "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  POSTGRES_HOST=$(echo -n "postgress-external-db-primary.$NAME_SPACE_POSTGRES_DB.svc.cluster.local" | base64 | tr -d '\n')
  sed_inplace "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${POSTGRES_HOST}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "${DIR}/resources/postgres-db/postgres-cred.yaml" --namespace="${project}"
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
  )

  for file in "${files[@]}"; do
    sed_inplace "s/namespace:.*/namespace: ${project}/g" "$file"
  done

  DH_TARGET_URL=$(echo -n "test-backstage-customization-provider-${project}.${K8S_CLUSTER_ROUTER_BASE}" | base64 -w 0)
  RHDH_BASE_URL=$(echo -n "$rhdh_base_url" | base64 | tr -d '\n')
  RHDH_BASE_URL_HTTP=$(echo -n "${rhdh_base_url/https/http}" | base64 | tr -d '\n')
  export DH_TARGET_URL RHDH_BASE_URL RHDH_BASE_URL_HTTP

  oc apply -f "$dir/resources/service_account/service-account-rhdh.yaml" --namespace="${project}"
  oc apply -f "$dir/auth/service-account-rhdh-secret.yaml" --namespace="${project}"

  oc apply -f "$dir/resources/cluster_role/cluster-role-k8s.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role/cluster-role-ocm.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-ocm.yaml" --namespace="${project}"

  OCM_CLUSTER_TOKEN=$(oc get secret rhdh-k8s-plugin-secret -n "${project}" -o=jsonpath='{.data.token}')
  export OCM_CLUSTER_TOKEN
  envsubst < "${DIR}/auth/secrets-rhdh-secrets.yaml" | oc apply --namespace="${project}" -f -

  # Select the configuration file based on the namespace or job
  config_file=$(select_config_map_file)
  # Apply the ConfigMap with the correct file
  create_app_config_map "$config_file" "$project"

  oc create configmap dynamic-plugins-config \
    --from-file="dynamic-plugins-config.yaml"="$dir/resources/config_map/dynamic-plugins-config.yaml" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -

  if [[ "$JOB_NAME" == *operator* ]] && [[ "${project}" == *rbac* ]]; then
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

  # configuration for testing global floating action button.
  oc create configmap dynamic-global-floating-action-button-config \
    --from-file="dynamic-global-floating-action-button-config.yaml"="$dir/resources/config_map/dynamic-global-floating-action-button-config.yaml" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -

  # configuration for testing global header and header mount points.
  oc create configmap dynamic-global-header-config \
    --from-file="dynamic-global-header-config.yaml"="$dir/resources/config_map/dynamic-global-header-config.yaml" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -

  # Create Pipeline run for tekton test case.
  oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline.yaml"
  oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline-run.yaml"

  # Create Deployment and Pipeline for Topology test.
  oc apply -f "$dir/resources/topology_test/topology-test.yaml"
  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
    kubectl apply -f "$dir/resources/topology_test/topology-test-ingress.yaml"
  else
    oc apply -f "$dir/resources/topology_test/topology-test-route.yaml"
  fi
}

deploy_test_backstage_customization_provider() {
  local project=$1
  echo "Deploying test-backstage-customization-provider in namespace ${project}"

  # Check if the buildconfig already exists
  if ! oc get buildconfig test-backstage-customization-provider -n "${project}" > /dev/null 2>&1; then
    echo "Creating new app for test-backstage-customization-provider"
    oc new-app -S openshift/nodejs:18-minimal-ubi8
    oc new-app https://github.com/janus-qe/test-backstage-customization-provider --image-stream="openshift/nodejs:18-ubi8" --namespace="${project}"
  else
    echo "BuildConfig for test-backstage-customization-provider already exists in ${project}. Skipping new-app creation."
  fi

  echo "Exposing service for test-backstage-customization-provider"
  oc expose svc/test-backstage-customization-provider --namespace="${project}"
}

deploy_redis_cache() {
  local namespace=$1
  envsubst < "$DIR/resources/redis-cache/redis-secret.yaml" | oc apply --namespace="${namespace}" -f -
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${namespace}"
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
  dynamic-plugins.yaml: |" > ${final_file}
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

run_tests() {
  local release_name=$1
  local project=$2
  cd "${DIR}/../../e2e-tests"
  local e2e_tests_dir
  e2e_tests_dir=$(pwd)

  yarn install --immutable > /tmp/yarn.install.log.txt 2>&1

  INSTALL_STATUS=$?
  if [ $INSTALL_STATUS -ne 0 ]; then
    echo "=== YARN INSTALL FAILED ==="
    cat /tmp/yarn.install.log.txt
    exit $INSTALL_STATUS
  else
    echo "Yarn install completed successfully."
  fi

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
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${project}/test-results" || true
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}" || true

  cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${project}/attachments/screenshots/" || true

  ansi2html < "/tmp/${LOGFILE}" > "/tmp/${LOGFILE}.html"
  cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${project}" || true
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${project}" || true

  save_data_router_junit_results "${project}"

  echo "${project} RESULT: ${RESULT}"
  if [ "${RESULT}" -ne 0 ]; then
    save_overall_result 1
    save_status_test_failed $CURRENT_DEPLOYMENT true
  else
    save_status_test_failed $CURRENT_DEPLOYMENT false
  fi
  if [ -f "${e2e_tests_dir}/${JUNIT_RESULTS}" ]; then
    failed_tests=$(grep -oP 'failures="\K[0-9]+' "${e2e_tests_dir}/${JUNIT_RESULTS}" | head -n 1)
    echo "Number of failed tests: ${failed_tests}"
    save_status_number_of_test_failed $CURRENT_DEPLOYMENT "${failed_tests}"
  else
    echo "JUnit results file not found: ${e2e_tests_dir}/${JUNIT_RESULTS}"
    local failed_tests="some"
    echo "Number of failed tests unknown, saving as $failed_tests."
    save_status_number_of_test_failed $CURRENT_DEPLOYMENT "${failed_tests}"
  fi
}

check_backstage_running() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30}
  local wait_seconds=${5:-30}

  if [ -z "${url}" ]; then
    echo "Error: URL is not set. Please provide a valid URL."
    return 1
  fi

  echo "Checking if Backstage is up and running at ${url}"

  for ((i = 1; i <= max_attempts; i++)); do
    # Check HTTP status
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}")

    if [ "${http_status}" -eq 200 ]; then
      echo "✅ Backstage is up and running!"
      export BASE_URL="${url}"
      echo "BASE_URL: ${BASE_URL}"
      return 0
    else
      echo "Attempt ${i} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
      oc get pods -n "${namespace}"
      sleep "${wait_seconds}"
    fi
  done

  echo "❌ Failed to reach Backstage at ${url} after ${max_attempts} attempts."
  oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -10
  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/" || true
  save_all_pod_logs "${namespace}"
  return 1
}

install_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    echo "OLM is already installed."
  else
    echo "OLM is not installed. Installing..."
    operator-sdk olm install
  fi
}

uninstall_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    echo "OLM is installed. Uninstalling..."
    operator-sdk olm uninstall
  else
    echo "OLM is not installed. Nothing to uninstall."
  fi
}

# Installs the advanced-cluster-management OCP Operator
install_acm_ocp_operator() {
  oc apply -f "${DIR}/cluster/operators/acm/operator-group.yaml"
  install_subscription advanced-cluster-management open-cluster-management release-2.14 advanced-cluster-management redhat-operators openshift-marketplace
  wait_for_deployment "open-cluster-management" "multiclusterhub-operator"
  wait_for_endpoint "multiclusterhub-operator-webhook" "open-cluster-management"
  oc apply -f "${DIR}/cluster/operators/acm/multiclusterhub.yaml"
  # wait until multiclusterhub is Running.
  timeout 900 bash -c 'while true; do
    CURRENT_PHASE=$(oc get multiclusterhub multiclusterhub -n open-cluster-management -o jsonpath="{.status.phase}")
    echo "MulticlusterHub Current Status: $CURRENT_PHASE"
    [[ "$CURRENT_PHASE" == "Running" ]] && echo "MulticlusterHub is now in Running phase." && break
    sleep 10
  done' || echo "Timed out after 15 minutes"
}

# TODO
# Installs Open Cluster Management K8S Operator (alternative of advanced-cluster-management for K8S clusters)
# TODO: Verify K8s compatibility and enable OCM tests if compatible
install_ocm_k8s_operator() {
  install_subscription my-cluster-manager operators stable cluster-manager operatorhubio-catalog olm
  wait_for_deployment "operators" "cluster-manager"
  wait_for_endpoint "multiclusterhub-operator-work-webhook" "open-cluster-management"
  oc apply -f "${DIR}/cluster/operators/acm/multiclusterhub.yaml"
  # wait until multiclusterhub is Running.
  timeout 600 bash -c 'while true; do
    CURRENT_PHASE=$(oc get multiclusterhub multiclusterhub -n open-cluster-management -o jsonpath="{.status.phase}")
    echo "MulticlusterHub Current Status: $CURRENT_PHASE"
    [[ "$CURRENT_PHASE" == "Running" ]] && echo "MulticlusterHub is now in Running phase." && break
    sleep 10
  done' || echo "Timed out after 10 minutes"
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
    install_subscription openshift-pipelines-operator openshift-operators latest openshift-pipelines-operator-rh redhat-operators openshift-marketplace
    wait_for_deployment "openshift-operators" "pipelines"
    wait_for_endpoint "tekton-pipelines-webhook" "openshift-pipelines"
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
    wait_for_endpoint "tekton-pipelines-webhook" "tekton-pipelines"
  fi
}

delete_tekton_pipelines() {
  echo "Checking for Tekton Pipelines installation..."
  # Check if tekton-pipelines namespace exists
  if kubectl get namespace tekton-pipelines &> /dev/null; then
    echo "Found Tekton Pipelines installation. Attempting to delete..."
    # Delete the resources and ignore errors
    kubectl delete -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml --ignore-not-found=true 2> /dev/null || true
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

cluster_setup_ocp_helm() {
  install_pipelines_operator
  install_acm_ocp_operator
  install_crunchy_postgres_ocp_operator
  install_orchestrator_infra_chart
}

cluster_setup_ocp_operator() {
  install_pipelines_operator
  install_acm_ocp_operator
  install_crunchy_postgres_ocp_operator
  install_serverless_ocp_operator
  install_serverless_logic_ocp_operator
}

cluster_setup_k8s_operator() {
  install_olm
  install_tekton_pipelines
  # install_ocm_k8s_operator
  # install_crunchy_postgres_k8s_operator # Works with K8s but disabled in values file
}

cluster_setup_k8s_helm() {
  # install_olm
  install_tekton_pipelines
  # install_ocm_k8s_operator
  # install_crunchy_postgres_k8s_operator # Works with K8s but disabled in values file
}

install_orchestrator_infra_chart() {
  ORCH_INFRA_NS="orchestrator-infra"
  configure_namespace ${ORCH_INFRA_NS}

  echo "Deploying orchestrator-infra chart"
  cd "${DIR}"
  helm upgrade -i orch-infra -n "${ORCH_INFRA_NS}" \
    "oci://quay.io/rhdh/orchestrator-infra-chart" --version "${CHART_VERSION}" \
    --wait --timeout=5m \
    --set serverlessLogicOperator.subscription.spec.installPlanApproval=Automatic \
    --set serverlessOperator.subscription.spec.installPlanApproval=Automatic

  until [ "$(oc get pods -n openshift-serverless --no-headers 2> /dev/null | wc -l)" -gt 0 ]; do
    sleep 5
  done

  until [ "$(oc get pods -n openshift-serverless-logic --no-headers 2> /dev/null | wc -l)" -gt 0 ]; do
    sleep 5
  done

  oc wait pod --all --for=condition=Ready --namespace=openshift-serverless --timeout=5m
  oc wait pod --all --for=condition=Ready --namespace=openshift-serverless-logic --timeout=5m

  oc get crd | grep "sonataflow" || echo "Sonataflow CRDs not found"
  oc get crd | grep "knative" || echo "Serverless CRDs not found"
}

# Helper function to get common helm set parameters
get_image_helm_set_params() {
  local params=""

  # Add image repository
  params+="--set upstream.backstage.image.repository=${QUAY_REPO} "

  # Add image tag
  params+="--set upstream.backstage.image.tag=${TAG_NAME} "

  echo "${params}"
}

# Helper function to perform helm install/upgrade
perform_helm_install() {
  local release_name=$1
  local namespace=$2
  local value_file=$3

  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${DIR}/value_files/${value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)
}

base_deployment() {
  configure_namespace ${NAME_SPACE}

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}"
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  perform_helm_install "${RELEASE_NAME}" "${NAME_SPACE}" "${HELM_CHART_VALUE_FILE_NAME}"

  deploy_orchestrator_workflows "${NAME_SPACE}"
}

rbac_deployment() {
  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  # Initiate rbac instance deployment.
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"
  perform_helm_install "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${HELM_CHART_RBAC_VALUE_FILE_NAME}"

  # NOTE: This is a workaround to allow the sonataflow platform to connect to the external postgres db using ssl.
  until [[ $(oc get jobs -n "${NAME_SPACE_RBAC}" 2> /dev/null | grep "${RELEASE_NAME_RBAC}-create-sonataflow-database" | wc -l) -eq 1 ]]; do
    echo "Waiting for sf db creation job to be created. Retrying in 5 seconds..."
    sleep 5
  done
  oc wait --for=condition=complete job/"${RELEASE_NAME_RBAC}-create-sonataflow-database" -n "${NAME_SPACE_RBAC}" --timeout=3m
  oc -n "${NAME_SPACE_RBAC}" patch sfp sonataflow-platform --type=merge \
    -p '{"spec":{"services":{"jobService":{"podTemplate":{"container":{"env":[{"name":"QUARKUS_DATASOURCE_REACTIVE_URL","value":"postgresql://postgress-external-db-primary.postgress-external-db.svc.cluster.local:5432/sonataflow?search_path=jobs-service&sslmode=require&ssl=true&trustAll=true"},{"name":"QUARKUS_DATASOURCE_REACTIVE_SSL_MODE","value":"require"},{"name":"QUARKUS_DATASOURCE_REACTIVE_TRUST_ALL","value":"true"}]}}}}}}'
  oc rollout restart deployment/sonataflow-platform-jobs-service -n "${NAME_SPACE_RBAC}"

  # initiate orchestrator workflows deployment
  deploy_orchestrator_workflows "${NAME_SPACE_RBAC}"
}

initiate_deployments() {
  cd "${DIR}"
  base_deployment
  rbac_deployment
}

# install base RHDH deployment before upgrade
initiate_upgrade_base_deployments() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30} # Default to 30 if not set
  local wait_seconds=${5:-30}

  echo "Initiating base RHDH deployment before upgrade"

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"

  configure_namespace "${namespace}"

  deploy_redis_cache "${namespace}"

  cd "${DIR}"

  apply_yaml_files "${DIR}" "${namespace}" "${url}"
  echo "Deploying image from base repository: ${QUAY_REPO_BASE}, TAG_NAME_BASE: ${TAG_NAME_BASE}, in NAME_SPACE: ${namespace}"

  # Get dynamic value file path based on previous release version
  local previous_release_value_file
  previous_release_value_file=$(get_previous_release_value_file "showcase")
  echo "Using dynamic value file: ${previous_release_value_file}"

  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION_BASE}" \
    -f "${previous_release_value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO_BASE}" \
    --set upstream.backstage.image.tag="${TAG_NAME_BASE}"
}

initiate_upgrade_deployments() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30} # Default to 30 if not set
  local wait_seconds=${5:-30}
  local wait_upgrade="10m"

  echo "Initiating upgrade deployment"
  cd "${DIR}"

  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase_upgrade.yaml" "/tmp/merged_value_file.yaml"
  echo "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged_value_file.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \
    --wait --timeout=${wait_upgrade}

  oc get pods -n "${namespace}"
  save_all_pod_logs $namespace
}

initiate_runtime_deployment() {
  local release_name=$1
  local namespace=$2
  configure_namespace "${namespace}"
  uninstall_helmchart "${namespace}" "${release_name}"
  sed_inplace "s|POSTGRES_USER:.*|POSTGRES_USER: $RDS_USER|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed_inplace "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: $(echo -n $RDS_PASSWORD | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed_inplace "s|POSTGRES_HOST:.*|POSTGRES_HOST: $(echo -n $RDS_1_HOST | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "$DIR/resources/postgres-db/postgres-crt-rds.yaml" -n "${namespace}"
  oc apply -f "$DIR/resources/postgres-db/postgres-cred.yaml" -n "${namespace}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${namespace}"

  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "$DIR/resources/postgres-db/values-showcase-postgres.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)
}

initiate_sanity_plugin_checks_deployment() {
  local release_name=$1
  local name_space_sanity_plugins_check=$2
  local sanity_plugins_url=$3

  configure_namespace "${name_space_sanity_plugins_check}"
  uninstall_helmchart "${name_space_sanity_plugins_check}" "${release_name}"
  deploy_redis_cache "${name_space_sanity_plugins_check}"
  apply_yaml_files "${DIR}" "${name_space_sanity_plugins_check}" "${sanity_plugins_url}"
  yq_merge_value_files "overwrite" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_SANITY_PLUGINS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME}"
  mkdir -p "${ARTIFACT_DIR}/${name_space_sanity_plugins_check}"
  cp -a "/tmp/${HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${name_space_sanity_plugins_check}/" || true # Save the final value-file into the artifacts directory.
  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${name_space_sanity_plugins_check}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params) \
    --set orchestrator.enabled=true
}

check_and_test() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30} # Default to 30 if not set
  local wait_seconds=${5:-30} # Default to 30 if not set

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"

  if check_backstage_running "${release_name}" "${namespace}" "${url}" "${max_attempts}" "${wait_seconds}"; then
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT false
    echo "Display pods for verification..."
    oc get pods -n "${namespace}"
    run_tests "${release_name}" "${namespace}"
  else
    echo "Backstage is not running. Exiting..."
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT true
    save_status_test_failed $CURRENT_DEPLOYMENT true
    save_overall_result 1
  fi
  save_all_pod_logs $namespace
}

check_upgrade_and_test() {
  local deployment_name="$1"
  local release_name="$2"
  local namespace="$3"
  local url=$4
  local timeout=${5:-600} # Timeout in seconds (default: 600 seconds)

  if check_helm_upgrade "${deployment_name}" "${namespace}" "${timeout}"; then
    check_and_test "${release_name}" "${namespace}" "${url}"
  else
    echo "Helm upgrade encountered an issue or timed out. Exiting..."
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT true
    save_status_test_failed $CURRENT_DEPLOYMENT true
    save_overall_result 1
  fi
}

check_helm_upgrade() {
  local deployment_name="$1"
  local namespace="$2"
  local timeout="$3"

  echo "Checking rollout status for deployment: ${deployment_name} in namespace: ${namespace}..."

  if oc rollout status "deployment/${deployment_name}" -n "${namespace}" --timeout="${timeout}s" -w; then
    echo "RHDH upgrade is complete."
    return 0
  else
    echo "RHDH upgrade encountered an issue or timed out."
    return 1
  fi
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

  local elapsed=0
  local sleep_interval=2
  local timeout_seconds=${2:-120}

  while oc get namespace "$project" &> /dev/null; do
    if [[ $elapsed -ge $timeout_seconds ]]; then
      echo "Timeout: Namespace '${project}' was not deleted within $timeout_seconds seconds." >&2
      return 1
    fi
    sleep $sleep_interval
    elapsed=$((elapsed + sleep_interval))
  done

  echo "Namespace '${project}' successfully deleted."
}

oc_login() {
  oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true
  echo "OCP version: $(oc version)"
}

is_openshift() {
  oc get routes.route.openshift.io &> /dev/null || kubectl get routes.route.openshift.io &> /dev/null
}

# Helper function for cross-platform sed
sed_inplace() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "$@"
  else
    # Linux
    sed -i "$@"
  fi
}

# Function to get the appropriate release version based on current branch
# Return the latest release version if current branch is not a release branch
# Return the previous release version if current branch is a release branch
get_previous_release_version() {
  local version=$1

  # Check if version parameter is provided
  if [[ -z "$version" ]]; then
    echo "Error: Version parameter is required" >&2
    exit 1
    save_overall_result 1
  fi

  # Validate version format (should be like "1.6")
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format X.Y (e.g., 1.6)" >&2
    exit 1
    save_overall_result 1
  fi

  # Extract major and minor version numbers
  local major_version
  major_version=$(echo "$version" | cut -d'.' -f1)
  local minor_version
  minor_version=$(echo "$version" | cut -d'.' -f2)

  # Calculate previous minor version
  local previous_minor=$((minor_version - 1))

  # Check if previous minor version is valid (non-negative)
  if [[ $previous_minor -lt 0 ]]; then
    echo "Error: Cannot calculate previous version for $version" >&2
    exit 1
    save_overall_result 1
  fi

  # Return the previous version
  echo "${major_version}.${previous_minor}"
}

get_chart_version() {
  local chart_major_version=$1
  curl -sSX GET "https://quay.io/api/v1/repository/rhdh/chart/tag/?onlyActiveTags=true&filter_tag_name=like:${chart_major_version}-" -H "Content-Type: application/json" \
    | jq '.tags[0].name' | grep -oE '[0-9]+\.[0-9]+-[0-9]+-CI'
}

# Helper function to get dynamic value file path based on previous release version
get_previous_release_value_file() {
  local value_file_type=${1:-"showcase"} # Default to showcase, can be "showcase-rbac" for RBAC

  # Get the previous release version
  local previous_release_version
  previous_release_version=$(get_previous_release_version "$CHART_MAJOR_VERSION")

  if [[ -z "$previous_release_version" ]]; then
    echo "Failed to determine previous release version." >&2
    save_overall_result 1
    exit 1
  fi

  echo "Using previous release version: ${previous_release_version}" >&2

  # Construct the GitHub URL for the value file
  local github_url="https://raw.githubusercontent.com/redhat-developer/rhdh/release-${previous_release_version}/.ibm/pipelines/value_files/values_${value_file_type}.yaml"

  # Create a temporary file path for the downloaded value file
  local temp_value_file="/tmp/values_${value_file_type}_${previous_release_version}.yaml"

  echo "Fetching value file from: ${github_url}" >&2

  # Download the value file from GitHub
  if curl -fsSL "${github_url}" -o "${temp_value_file}"; then
    echo "Successfully downloaded value file to: ${temp_value_file}" >&2
    echo "${temp_value_file}"
  else
    echo "Failed to download value file from GitHub." >&2
    save_overall_result 1
    exit 1
  fi
}

# Helper function to deploy workflows for orchestrator testing
deploy_orchestrator_workflows() {
  local namespace=$1

  local WORKFLOW_REPO="https://github.com/rhdh-orchestrator-test/serverless-workflows.git"
  local WORKFLOW_DIR="${DIR}/serverless-workflows"
  local WORKFLOW_MANIFESTS="${WORKFLOW_DIR}/workflows/experimentals/user-onboarding/manifests/"

  rm -rf "${WORKFLOW_DIR}"
  git clone "${WORKFLOW_REPO}" "${WORKFLOW_DIR}"

  if [[ "$namespace" == "${NAME_SPACE_RBAC}" ]]; then
    local pqsl_secret_name="postgres-cred"
    local pqsl_user_key="POSTGRES_USER"
    local pqsl_password_key="POSTGRES_PASSWORD"
    local pqsl_svc_name="postgress-external-db-primary"
    local patch_namespace="${NAME_SPACE_POSTGRES_DB}"
  else
    local pqsl_secret_name="rhdh-postgresql-svcbind-postgres"
    local pqsl_user_key="username"
    local pqsl_password_key="password"
    local pqsl_svc_name="rhdh-postgresql"
    local patch_namespace="$namespace"
  fi

  oc apply -f "${WORKFLOW_MANIFESTS}"

  helm repo add orchestrator-workflows https://rhdhorchestrator.io/serverless-workflows
  helm install greeting orchestrator-workflows/greeting -n "$namespace"

  until [[ $(oc get sf -n "$namespace" --no-headers 2> /dev/null | wc -l) -eq 2 ]]; do
    echo "No sf resources found. Retrying in 5 seconds..."
    sleep 5
  done

  for workflow in greeting user-onboarding; do
    oc -n "$namespace" patch sonataflow "$workflow" --type merge -p "{\"spec\": { \"persistence\": { \"postgresql\": { \"secretRef\": {\"name\": \"$pqsl_secret_name\",\"userKey\": \"$pqsl_user_key\",\"passwordKey\": \"$pqsl_password_key\"},\"serviceRef\": {\"name\": \"$pqsl_svc_name\",\"namespace\": \"$patch_namespace\"}}}}}"
  done
}

# Helper function to deploy workflows for orchestrator testing
deploy_orchestrator_workflows_operator() {
  local namespace=$1

  local WORKFLOW_REPO="https://github.com/rhdh-orchestrator-test/serverless-workflows.git"
  local WORKFLOW_DIR="${DIR}/serverless-workflows"
  local WORKFLOW_MANIFESTS="${WORKFLOW_DIR}/workflows/experimentals/user-onboarding/manifests/"

  rm -rf "${WORKFLOW_DIR}"
  git clone --depth=1 "${WORKFLOW_REPO}" "${WORKFLOW_DIR}"

  # Wait for backstage and sonata flow pods to be ready before continuing
  wait_for_deployment $namespace backstage-psql 15
  wait_for_deployment $namespace backstage-rhdh 15
  wait_for_deployment $namespace sonataflow-platform-data 20
  wait_for_deployment $namespace sonataflow-platform-jobs-service 20

  # Dynamic PostgreSQL configuration detection
  # Dynamic discovery of PostgreSQL secret and service using patterns
  local pqsl_secret_name
  pqsl_secret_name=$(oc get secrets -n "$namespace" -o name | grep "backstage-psql" | grep "secret" | head -1 | sed 's/secret\///')
  local pqsl_user_key="POSTGRES_USER"
  local pqsl_password_key="POSTGRES_PASSWORD"
  local pqsl_svc_name
  pqsl_svc_name=$(oc get svc -n "$namespace" -o name | grep "backstage-psql" | grep -v "secret" | head -1 | sed 's/service\///')
  local patch_namespace="$namespace"
  local sonataflow_db="backstage_plugin_orchestrator"

  # Validate that we found the required resources
  if [[ -z "$pqsl_secret_name" ]]; then
    echo "Error: No PostgreSQL secret found matching pattern 'backstage-psql.*secret' in namespace '$namespace'"
    return 1
  fi

  if [[ -z "$pqsl_svc_name" ]]; then
    echo "Error: No PostgreSQL service found matching pattern 'backstage-psql' in namespace '$namespace'"
    return 1
  fi

  echo "Found PostgreSQL secret: $pqsl_secret_name"
  echo "Found PostgreSQL service: $pqsl_svc_name"

  # Apply user-onboarding workflow manifests
  oc apply -f "${WORKFLOW_MANIFESTS}" -n "$namespace"

  # Install greeting workflow via helm
  helm repo add orchestrator-workflows https://rhdhorchestrator.io/serverless-workflows || true
  helm upgrade --install greeting orchestrator-workflows/greeting -n "$namespace" --wait --timeout=5m --atomic

  # Wait for sonataflow resources to be created (regardless of state)
  timeout 30s bash -c "
  until [[ \$(oc get sf -n $namespace --no-headers 2>/dev/null | wc -l) -eq 2 ]]; do
    echo \"Waiting for 2 sf resources... Current count: \$(oc get sf -n $namespace --no-headers 2>/dev/null | wc -l)\"
    sleep 5
  done
  "
  echo "Updating user-onboarding secret with dynamic service URLs..."
  # Update the user-onboarding secret with correct service URLs
  local onboarding_server_url="http://user-onboarding-server:8080"

  # Dynamically determine the backstage service (excluding psql)
  local backstage_service
  backstage_service=$(oc get svc -l app.kubernetes.io/name=backstage -n "$namespace" --no-headers=true | grep -v psql | awk '{print $1}' | head -1)
  if [[ -z "$backstage_service" ]]; then
    echo "Warning: No backstage service found, using fallback"
    backstage_service="backstage-rhdh"
  fi
  local backstage_notifications_url="http://${backstage_service}:80"

  # Get the notifications bearer token from rhdh-secrets
  local notifications_bearer_token
  notifications_bearer_token=$(oc get secret rhdh-secrets -n "$namespace" -o json | jq '.data.BACKEND_SECRET' -r | base64 -d)
  if [[ -z "$notifications_bearer_token" ]]; then
    echo "Warning: No BACKEND_SECRET found in rhdh-secrets, using empty token"
    notifications_bearer_token=""
  fi

  # Base64 encode the URLs and token
  local onboarding_server_url_b64
  onboarding_server_url_b64=$(echo -n "$onboarding_server_url" | base64 -w 0)
  local backstage_notifications_url_b64
  backstage_notifications_url_b64=$(echo -n "$backstage_notifications_url" | base64 -w 0)
  local notifications_bearer_token_b64
  notifications_bearer_token_b64=$(echo -n "$notifications_bearer_token" | base64 -w 0)

  # Patch the secret
  oc patch secret user-onboarding-creds -n "$namespace" --type merge -p "{
    \"data\": {
      \"ONBOARDING_SERVER_URL\": \"$onboarding_server_url_b64\",
      \"BACKSTAGE_NOTIFICATIONS_URL\": \"$backstage_notifications_url_b64\",
      \"NOTIFICATIONS_BEARER_TOKEN\": \"$notifications_bearer_token_b64\"
    }
  }"
  echo "User-onboarding secret updated successfully!"

  for workflow in greeting user-onboarding; do
    # Create PostgreSQL patch configuration
    local postgres_patch
    postgres_patch=$(
      cat << EOF
{
  "spec": {
    "persistence": {
      "postgresql": {
        "secretRef": {
          "name": "$pqsl_secret_name",
          "userKey": "$pqsl_user_key",
          "passwordKey": "$pqsl_password_key"
        },
        "serviceRef": {
          "name": "$pqsl_svc_name",
          "namespace": "$patch_namespace",
          "databaseName": "$sonataflow_db"
        }
      }
    }
  }
}
EOF
    )

    echo "Patching SonataFlow '$workflow' with PostgreSQL configuration..."
    oc -n "$namespace" patch sonataflow "$workflow" --type merge -p "$postgres_patch"

    echo "Restarting deployment for '$workflow'..."
    oc rollout status deployment/"$workflow" -n "$namespace" --timeout=600s
  done

  echo "Waiting for all workflow pods to be running..."
  wait_for_deployment $namespace greeting 5
  wait_for_deployment $namespace user-onboarding 5

  echo "All workflow pods are now running!"
}

# Helper function to wait for backstage resource to exist in namespace
wait_for_backstage_resource() {
  local namespace=$1
  local max_attempts=40 # 40 attempts * 15 seconds = 10 minutes

  local sleep_interval=15

  echo "Waiting for backstage resource to exist in namespace: $namespace"

  for ((i = 1; i <= max_attempts; i++)); do
    if [[ $(oc get backstage -n "$namespace" -o json | jq '.items | length') -gt 0 ]]; then
      echo "Backstage resource found in namespace: $namespace"
      return 0
    fi
    echo "Attempt $i/$max_attempts: No backstage resource found, waiting ${sleep_interval}s..."
    sleep $sleep_interval
  done

  echo "Error: No backstage resource found after 10 minutes"
  return 1
}

# Helper function to enable orchestrator plugins by merging default and custom dynamic plugins
enable_orchestrator_plugins_op() {
  local namespace=$1

  # Validate required parameter
  if [[ -z "$namespace" ]]; then
    echo "Error: Missing required namespace parameter"
    echo "Usage: enable_orchestrator_plugins_op <namespace>"
    return 1
  fi

  echo "Enabling orchestrator plugins in namespace: $namespace"

  # Wait for backstage resource to exist
  wait_for_backstage_resource "$namespace"
  sleep 5

  # Setup working directory
  local work_dir="/tmp/orchestrator-plugins-merge"
  rm -rf "$work_dir" && mkdir -p "$work_dir"

  # Extract custom dynamic plugins configmap
  echo "Extracting custom dynamic plugins configmap..."
  if ! oc get cm dynamic-plugins -n "$namespace" -o json | jq '.data."dynamic-plugins.yaml"' -r > "$work_dir/custom-plugins.yaml"; then
    echo "Error: Failed to extract dynamic-plugins configmap"
    return 1
  fi

  # Find and extract default configmap
  echo "Finding default dynamic plugins configmap..."
  local default_cm
  default_cm=$(oc get cm -n "$namespace" --no-headers | grep "backstage-dynamic-plugins" | awk '{print $1}' | head -1)

  if [[ -z "$default_cm" ]]; then
    echo "Error: No default configmap found matching pattern 'backstage-dynamic-plugins-'"
    return 1
  fi

  echo "Found default configmap: $default_cm"
  if ! oc get cm "$default_cm" -n "$namespace" -o json | jq '.data."dynamic-plugins.yaml"' -r > "$work_dir/default-plugins.yaml"; then
    echo "Error: Failed to extract $default_cm configmap"
    return 1
  fi

  # Extract plugins array with disabled: false and append to custom plugins
  echo "Extracting and enabling default plugins..."
  if ! yq eval '.plugins | map(. + {"disabled": false})' "$work_dir/default-plugins.yaml" > "$work_dir/default-plugins-array.yaml"; then
    echo "Error: Failed to extract and modify plugins array from default file"
    return 1
  fi

  if ! yq eval '.plugins += load("'$work_dir'/default-plugins-array.yaml")' -i "$work_dir/custom-plugins.yaml"; then
    echo "Error: Failed to append default plugins to custom plugins"
    return 1
  fi

  # Use the modified custom file as the final merged result
  if ! cp "$work_dir/custom-plugins.yaml" "$work_dir/merged-plugins.yaml"; then
    echo "Error: Failed to create merged plugins file"
    return 1
  fi

  # Apply new configmap with merged content
  if ! oc create configmap dynamic-plugins \
    --from-file="dynamic-plugins.yaml=$work_dir/merged-plugins.yaml" \
    -n "$namespace" --dry-run=client -o yaml | oc apply -f -; then
    echo "Error: Failed to apply updated dynamic-plugins configmap"
    return 1
  fi

  # Find and restart backstage deployment
  echo "Finding backstage deployment..."
  local backstage_deployment
  backstage_deployment=$(oc get deployment -n "$namespace" --no-headers | grep "^backstage-rhdh" | awk '{print $1}' | head -1)

  if [[ -z "$backstage_deployment" ]]; then
    echo "Error: No backstage deployment found matching pattern 'backstage-rhdh*'"
    return 1
  fi

  echo "Restarting backstage deployment: $backstage_deployment"
  if ! oc rollout restart deployment/"$backstage_deployment" -n "$namespace"; then
    echo "Error: Failed to restart backstage deployment"
    return 1
  fi

  # Cleanup
  rm -rf "$work_dir"

  echo "Successfully enabled orchestrator plugins in namespace: $namespace"
}
