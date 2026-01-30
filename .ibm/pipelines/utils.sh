#!/bin/bash

# shellcheck source=.ibm/pipelines/reporting.sh
source "${DIR}/reporting.sh"
# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ibm/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"
# shellcheck source=.ibm/pipelines/lib/operators.sh
source "${DIR}/lib/operators.sh"
# shellcheck source=.ibm/pipelines/lib/k8s-wait.sh
source "${DIR}/lib/k8s-wait.sh"
# shellcheck source=.ibm/pipelines/lib/orchestrator.sh
source "${DIR}/lib/orchestrator.sh"

# Constants
TEKTON_PIPELINES_WEBHOOK="tekton-pipelines-webhook"

retrieve_pod_logs() {
  local pod_name=$1
  local container=$2
  local namespace=$3
  local log_timeout=${4:-5} # Default timeout: 5 seconds (reduced from 30s to speed up failure cases)
  log::debug "Retrieving logs for container: $container"
  # Save logs for the current and previous container with timeout to prevent hanging
  timeout "${log_timeout}" kubectl logs "$pod_name" -c "$container" -n "$namespace" > "pod_logs/${pod_name}_${container}.log" 2> /dev/null || { log::warn "logs for container $container not found or timed out"; }
  timeout "${log_timeout}" kubectl logs "$pod_name" -c "$container" -n "$namespace" --previous > "pod_logs/${pod_name}_${container}-previous.log" 2> /dev/null || {
    log::debug "Previous logs for container $container not found or timed out"
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
    log::debug "Retrieving logs for pod: $pod_name in namespace $namespace"

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

# ==============================================================================
# FUTURE MODULE: lib/helm.sh
# Functions: yq_merge_value_files, uninstall_helmchart, get_image_helm_set_params,
#            perform_helm_install, get_chart_version, get_previous_release_value_file
# ==============================================================================

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
    log::error "Invalid operation with plugins key: $plugin_operation"
    exit 1
  fi
}

# ==============================================================================
# Orchestrator Functions - Delegate to lib/orchestrator.sh
# ==============================================================================
should_skip_orchestrator() { orchestrator::should_skip; }

disable_orchestrator_plugins_in_values() {
  orchestrator::disable_plugins_in_values "$@"
  return $?
}

# ==============================================================================
# K8s Wait Functions - Delegate to lib/k8s-wait.sh
# ==============================================================================
wait_for_deployment() { k8s_wait::deployment "$@"; }

wait_for_job_completion() { k8s_wait::job "$@"; }

wait_for_svc() { k8s_wait::service "$@"; }

wait_for_endpoint() { k8s_wait::endpoint "$@"; }

# ==============================================================================
# Operator Functions - Delegate to lib/operators.sh
# ==============================================================================
install_subscription() { operator::install_subscription "$@"; }

# ==============================================================================
# FUTURE MODULE: lib/namespace.sh
# Functions: configure_namespace, delete_namespace, force_delete_namespace,
#            remove_finalizers_from_resources, setup_image_pull_secret,
#            create_secret_dockerconfigjson, add_image_pull_secret_to_namespace_default_serviceaccount
# ==============================================================================

create_secret_dockerconfigjson() {
  namespace=$1
  secret_name=$2
  dockerconfigjson_value=$3
  log::info "Creating dockerconfigjson secret $secret_name in namespace $namespace"
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
  log::info "Adding image pull secret $secret_name to default service account"
  kubectl -n "${namespace}" patch serviceaccount default -p "{\"imagePullSecrets\": [{\"name\": \"${secret_name}\"}]}"
}
setup_image_pull_secret() {
  local namespace=$1
  local secret_name=$2
  local dockerconfigjson_value=$3
  log::info "Creating $secret_name secret in $namespace namespace"
  create_secret_dockerconfigjson "$namespace" "$secret_name" "$dockerconfigjson_value"
  add_image_pull_secret_to_namespace_default_serviceaccount "$namespace" "$secret_name"
}

check_operator_status() { operator::check_status "$@"; }

# Installs the Crunchy Postgres Operator
# Args: platform ("ocp" or "k8s", default: "ocp")
install_crunchy_postgres_operator() {
  local platform=${1:-ocp}
  install_subscription crunchy-postgres-operator openshift-operators v5 crunchy-postgres-operator certified-operators openshift-marketplace
}

# Waits for the Crunchy Postgres Operator to be ready
# Args: platform ("ocp" or "k8s", default: "ocp")
waitfor_crunchy_postgres_operator() {
  local platform=${1:-ocp}
  local namespace="openshift-operators"
  [[ "$platform" == "k8s" ]] && namespace="operators"

  check_operator_status 300 "$namespace" "Crunchy Postgres for Kubernetes" "Succeeded"
  k8s_wait::crd "postgresclusters.postgres-operator.crunchydata.com" 120 5 || return 1
}

# Backward compatibility shims
install_crunchy_postgres_ocp_operator() { install_crunchy_postgres_operator "ocp"; }
install_crunchy_postgres_k8s_operator() { install_crunchy_postgres_operator "k8s"; }
waitfor_crunchy_postgres_ocp_operator() { waitfor_crunchy_postgres_operator "ocp"; }
waitfor_crunchy_postgres_k8s_operator() { waitfor_crunchy_postgres_operator "k8s"; }

# Installs the OpenShift Serverless Logic Operator (SonataFlow) from OpenShift Marketplace
# Use waitfor_serverless_logic_ocp_operator to wait for the operator to be ready
install_serverless_logic_ocp_operator() {
  install_subscription logic-operator-rhel8 openshift-operators alpha logic-operator-rhel8 redhat-operators openshift-marketplace
}

waitfor_serverless_logic_ocp_operator() {
  check_operator_status 300 "openshift-operators" "OpenShift Serverless Logic Operator" "Succeeded"
}

# Installs the OpenShift Serverless Operator (Knative) from OpenShift Marketplace
# Use waitfor_serverless_ocp_operator to wait for the operator to be ready
install_serverless_ocp_operator() {
  install_subscription serverless-operator openshift-operators stable serverless-operator redhat-operators openshift-marketplace
}

waitfor_serverless_ocp_operator() {
  check_operator_status 300 "openshift-operators" "Red Hat OpenShift Serverless" "Succeeded"
}

uninstall_helmchart() {
  local project=$1
  local release=$2
  if helm list -n "${project}" | grep -q "${release}"; then
    log::warn "Chart already exists. Removing it before install."
    helm uninstall "${release}" -n "${project}"
  fi
}

configure_namespace() {
  local project=$1
  log::warn "Deleting and recreating namespace: $project"
  delete_namespace $project

  if ! oc create namespace "${project}"; then
    log::error "Error: Failed to create namespace ${project}" >&2
    exit 1
  fi
  if ! oc config set-context --current --namespace="${project}"; then
    log::error "Error: Failed to set context for namespace ${project}" >&2
    exit 1
  fi

  echo "Namespace ${project} is ready."
}

delete_namespace() {
  local project=$1
  if oc get namespace "$project" > /dev/null 2>&1; then
    log::warn "Namespace ${project} exists. Attempting to delete..."

    # Remove blocking finalizers
    # remove_finalizers_from_resources "$project"

    # Attempt to delete the namespace
    oc delete namespace "$project" --grace-period=0 --force || true

    # Check if namespace is still stuck in 'Terminating' and force removal if necessary
    if oc get namespace "$project" -o jsonpath='{.status.phase}' | grep -q 'Terminating'; then
      log::warn "Namespace ${project} is stuck in Terminating. Forcing deletion..."
      force_delete_namespace "$project"
    fi
  fi
}

configure_external_postgres_db() {
  local project=$1
  local max_attempts=60 # 5 minutes total (60 attempts × 5 seconds)
  local wait_interval=5

  log::info "Creating PostgresCluster in namespace ${NAME_SPACE_POSTGRES_DB}..."

  # Validate oc apply command execution
  if ! oc apply -f "${DIR}/resources/postgres-db/postgres.yaml" --namespace="${NAME_SPACE_POSTGRES_DB}"; then
    log::error "Failed to create PostgresCluster"
    return 1
  fi

  # Wait for cluster cert secret (usually created quickly)
  log::info "Waiting for cluster certificate secret..."
  if ! common::poll_until \
    "oc get secret postgress-external-db-cluster-cert -n '${NAME_SPACE_POSTGRES_DB}'" \
    "$max_attempts" "$wait_interval" \
    "Cluster certificate secret found"; then
    return 1
  fi

  # Extract cluster certificates
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.ca\.crt}' | base64 --decode > postgres-ca
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.crt}' | base64 --decode > postgres-tls-crt
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.key}' | base64 --decode > postgres-tls-key

  # Validate secret creation
  if ! oc create secret generic postgress-external-db-cluster-cert \
    --from-file=ca.crt=postgres-ca \
    --from-file=tls.crt=postgres-tls-crt \
    --from-file=tls.key=postgres-tls-key \
    --dry-run=client -o yaml | oc apply -f - --namespace="${project}"; then
    log::error "Failed to create cluster certificate secret"
    return 1
  fi

  # Wait for USER secret (this is the critical one that causes CI failures!)
  log::info "Waiting for PostgreSQL user secret 'postgress-external-db-pguser-janus-idp'..."
  log::info "This secret is created by the Crunchy Postgres operator after the database is ready"
  if ! common::poll_until \
    "oc get secret postgress-external-db-pguser-janus-idp -n '${NAME_SPACE_POSTGRES_DB}'" \
    "$max_attempts" "$wait_interval" \
    "PostgreSQL user secret found"; then
    log::error "This usually means the Crunchy Postgres operator failed to create the user"
    log::info "Checking PostgresCluster status..."
    oc describe postgrescluster postgress-external-db -n "${NAME_SPACE_POSTGRES_DB}" || true
    log::info "Checking operator logs..."
    oc logs -n "${NAME_SPACE_POSTGRES_DB}" -l postgres-operator.crunchydata.com/cluster=postgress-external-db --tail=50 || true
    return 1
  fi

  # Now we can safely get the password
  POSTGRES_PASSWORD=$(oc get secret/postgress-external-db-pguser-janus-idp -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.password}')
  sed_inplace "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  POSTGRES_HOST=$(common::base64_encode "postgress-external-db-primary.$NAME_SPACE_POSTGRES_DB.svc.cluster.local")
  sed_inplace "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${POSTGRES_HOST}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"

  # Validate final configuration apply
  if ! oc apply -f "${DIR}/resources/postgres-db/postgres-cred.yaml" --namespace="${project}"; then
    log::error "Failed to apply PostgreSQL credentials"
    return 1
  fi

  log::success "External PostgreSQL database configured successfully!"
}

apply_yaml_files() {
  local dir=$1
  local project=$2
  local rhdh_base_url=$3
  log::info "Applying YAML files to namespace ${project}"

  oc config set-context --current --namespace="${project}"

  local files=(
    "$dir/resources/service_account/service-account-rhdh.yaml"
    "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml"
    "$dir/resources/cluster_role/cluster-role-k8s.yaml"
  )

  for file in "${files[@]}"; do
    sed_inplace "s/namespace:.*/namespace: ${project}/g" "$file"
  done

  DH_TARGET_URL=$(common::base64_encode "test-backstage-customization-provider-${project}.${K8S_CLUSTER_ROUTER_BASE}")
  RHDH_BASE_URL=$(common::base64_encode "$rhdh_base_url")
  RHDH_BASE_URL_HTTP=$(common::base64_encode "${rhdh_base_url/https/http}")
  export DH_TARGET_URL RHDH_BASE_URL RHDH_BASE_URL_HTTP

  oc apply -f "$dir/resources/service_account/service-account-rhdh.yaml" --namespace="${project}"
  oc apply -f "$dir/auth/service-account-rhdh-secret.yaml" --namespace="${project}"

  oc apply -f "$dir/resources/cluster_role/cluster-role-k8s.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml" --namespace="${project}"

  envsubst < "${DIR}/auth/secrets-rhdh-secrets.yaml" | oc apply --namespace="${project}" -f -

  # Select the configuration file based on the namespace or job
  config_file=$(select_config_map_file)
  # Apply the ConfigMap with the correct file
  create_app_config_map "$config_file" "$project"

  common::create_configmap_from_file "dynamic-plugins-config" "$project" \
    "dynamic-plugins-config.yaml" "$dir/resources/config_map/dynamic-plugins-config.yaml"

  if [[ "$JOB_NAME" == *operator* ]] && [[ "${project}" == *rbac* ]]; then
    common::create_configmap_from_files "rbac-policy" "$project" \
      "rbac-policy.csv=$dir/resources/config_map/rbac-policy.csv" \
      "conditional-policies.yaml=/tmp/conditional-policies.yaml"
  else
    common::create_configmap_from_file "rbac-policy" "$project" \
      "rbac-policy.csv" "$dir/resources/config_map/rbac-policy.csv"
  fi

  # configuration for testing global floating action button.
  common::create_configmap_from_file "dynamic-global-floating-action-button-config" "$project" \
    "dynamic-global-floating-action-button-config.yaml" "$dir/resources/config_map/dynamic-global-floating-action-button-config.yaml"

  # configuration for testing global header and header mount points.
  common::create_configmap_from_file "dynamic-global-header-config" "$project" \
    "dynamic-global-header-config.yaml" "$dir/resources/config_map/dynamic-global-header-config.yaml"

  # Skip Tekton and Topology resources for K8s deployments (AKS/EKS/GKE)
  # Tekton tests are not executed in showcase-k8s or showcase-rbac-k8s projects
  if [[ "$JOB_NAME" != *"aks"* && "$JOB_NAME" != *"eks"* && "$JOB_NAME" != *"gke"* ]]; then
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
  else
    log::info "Skipping Tekton Pipeline and Topology resources for K8s deployment (${JOB_NAME})"
  fi
}

deploy_test_backstage_customization_provider() {
  local project=$1
  log::info "Deploying test-backstage-customization-provider in namespace ${project}"

  # Check if the buildconfig already exists
  if ! oc get buildconfig test-backstage-customization-provider -n "${project}" > /dev/null 2>&1; then
    # Get latest nodejs UBI9 tag from cluster, fallback to 18-ubi8
    local nodejs_tag
    nodejs_tag=$(oc get imagestream nodejs -n openshift -o jsonpath='{.spec.tags[*].name}' 2> /dev/null \
      | tr ' ' '\n' | grep -E '^[0-9]+-ubi9$' | sort -t'-' -k1 -n | tail -1)
    nodejs_tag="${nodejs_tag:-18-ubi8}"
    log::info "Creating new app for test-backstage-customization-provider using nodejs:${nodejs_tag}"
    oc new-app "openshift/nodejs:${nodejs_tag}~https://github.com/janus-qe/test-backstage-customization-provider" --namespace="${project}"
  else
    log::warn "BuildConfig for test-backstage-customization-provider already exists in ${project}. Skipping new-app creation."
  fi

  log::info "Exposing service for test-backstage-customization-provider"
  oc expose svc/test-backstage-customization-provider --namespace="${project}"
}

deploy_redis_cache() {
  local namespace=$1
  envsubst < "$DIR/resources/redis-cache/redis-secret.yaml" | oc apply --namespace="${namespace}" -f -
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${namespace}"
}

# ==============================================================================
# FUTURE MODULE: lib/config.sh
# Functions: create_app_config_map, select_config_map_file, create_dynamic_plugins_config,
#            create_conditional_policies_operator, prepare_operator_app_config
# ==============================================================================

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
  sed_inplace 's/\\\$/\$/g' "$destination_file"
}

prepare_operator_app_config() {
  local config_file=$1
  yq e -i '.permission.rbac.conditionalPoliciesFile = "./rbac/conditional-policies.yaml"' ${config_file}
}

# ==============================================================================
# FUTURE MODULE: lib/testing.sh
# Functions: run_tests, check_backstage_running, check_and_test, check_upgrade_and_test,
#            check_helm_upgrade
# ==============================================================================

run_tests() {
  local release_name=$1
  local namespace=$2
  local playwright_project=$3
  local url="${4:-}"

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"
  save_status_failed_to_deploy $CURRENT_DEPLOYMENT false

  BASE_URL="${url}"
  export BASE_URL
  log::info "BASE_URL: ${BASE_URL}"
  log::info "Running Playwright project '${playwright_project}' against namespace '${namespace}'"

  cd "${DIR}/../../e2e-tests"
  local e2e_tests_dir
  e2e_tests_dir=$(pwd)

  yarn install --immutable > /tmp/yarn.install.log.txt 2>&1
  INSTALL_STATUS=$?
  if [ $INSTALL_STATUS -ne 0 ]; then
    log::error "=== YARN INSTALL FAILED ==="
    cat /tmp/yarn.install.log.txt
    exit $INSTALL_STATUS
  else
    log::success "Yarn install completed successfully."
  fi

  yarn playwright install chromium

  Xvfb :99 &
  export DISPLAY=:99

  (
    set -e
    log::info "Using PR container image: ${TAG_NAME}"
    # Run Playwright directly with --project flag instead of using yarn script aliases
    yarn playwright test --project="${playwright_project}"
  ) 2>&1 | tee "/tmp/${LOGFILE}"

  local RESULT=${PIPESTATUS[0]}

  pkill Xvfb || true

  # Use namespace for artifact directory to keep artifacts organized by deployment
  mkdir -p "${ARTIFACT_DIR}/${namespace}/test-results"
  mkdir -p "${ARTIFACT_DIR}/${namespace}/attachments/screenshots"
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${namespace}/test-results" || true
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" || true
  if [[ "${CI}" == "true" ]]; then
    cp "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" "${SHARED_DIR}/junit-results-${namespace}.xml" || true
  fi

  cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${namespace}/attachments/screenshots/" || true
  ansi2html < "/tmp/${LOGFILE}" > "/tmp/${LOGFILE}.html"
  cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${namespace}" || true
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${namespace}" || true

  echo "Playwright project '${playwright_project}' in namespace '${namespace}' RESULT: ${RESULT}"
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
    log::error "Error: URL is not set. Please provide a valid URL."
    return 1
  fi

  log::info "Checking if Backstage is up and running at ${url}"

  for ((i = 1; i <= max_attempts; i++)); do
    # Check HTTP status
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}")

    if [ "${http_status}" -eq 200 ]; then
      log::success "✅ Backstage is up and running!"
      return 0
    else
      log::warn "Attempt ${i} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
      oc get pods -n "${namespace}"

      # Early crash detection: fail fast if RHDH pods are in CrashLoopBackOff
      # Check both the main deployment and postgresql pods
      local crash_pods
      crash_pods=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/instance in (${release_name},redhat-developer-hub,developer-hub,${release_name}-postgresql)" \
        -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.phase}{" "}{range .status.containerStatuses[*]}{.state.waiting.reason}{end}{range .status.initContainerStatuses[*]}{.state.waiting.reason}{end}{"\n"}{end}' 2> /dev/null | grep -E "CrashLoopBackOff" || true)
      # Also check by name pattern for postgresql pods that may have different labels
      if [ -z "${crash_pods}" ]; then
        crash_pods=$(oc get pods -n "${namespace}" --no-headers 2> /dev/null | grep -E "(${release_name}|developer-hub|postgresql)" | grep -E "CrashLoopBackOff|Init:CrashLoopBackOff" || true)
      fi

      if [ -n "${crash_pods}" ]; then
        log::error "Detected pods in CrashLoopBackOff state - failing fast instead of waiting:"
        echo "${crash_pods}"
        log::error "Deployment status:"
        oc get deployment -l "app.kubernetes.io/instance in (${release_name},redhat-developer-hub,developer-hub)" -n "${namespace}" -o wide 2> /dev/null || true
        log::error "Recent logs from deployment:"
        oc logs deployment/${release_name}-developer-hub -n "${namespace}" --tail=100 --all-containers=true 2> /dev/null \
          || oc logs deployment/${release_name} -n "${namespace}" --tail=100 --all-containers=true 2> /dev/null || true
        log::error "Recent events:"
        oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -20
        mkdir -p "${ARTIFACT_DIR}/${namespace}"
        cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/" || true
        save_all_pod_logs "${namespace}"
        return 1
      fi

      sleep "${wait_seconds}"
    fi
  done

  log::error "❌ Failed to reach Backstage at ${url} after ${max_attempts} attempts."
  oc get events -n "${namespace}" --sort-by='.lastTimestamp' | tail -10
  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/" || true
  save_all_pod_logs "${namespace}"
  return 1
}

# OLM Functions - Delegate to lib/operators.sh
install_olm() { operator::install_olm "$@"; }
uninstall_olm() { operator::uninstall_olm "$@"; }

# Installs the Red Hat OpenShift Pipelines operator if not already installed
# Use waitfor_pipelines_operator to wait for the operator to be ready
install_pipelines_operator() {
  local display_name="Red Hat OpenShift Pipelines"
  # Check if operator is already installed
  if oc get csv -n "openshift-operators" | grep -q "${display_name}"; then
    log::warn "Red Hat OpenShift Pipelines operator is already installed."
  else
    log::info "Red Hat OpenShift Pipelines operator is not installed. Installing..."
    install_subscription openshift-pipelines-operator openshift-operators latest openshift-pipelines-operator-rh redhat-operators openshift-marketplace
  fi
  # Wait for Tekton Pipeline CRD to be registered before proceeding
  k8s_wait::crd "pipelines.tekton.dev" 120 5 || return 1
}

waitfor_pipelines_operator() {
  wait_for_deployment "openshift-operators" "pipelines"
  wait_for_endpoint "tekton-pipelines-webhook" "openshift-pipelines"
}

# Installs the Tekton Pipelines if not already installed (alternative of OpenShift Pipelines for Kubernetes clusters)
# Use waitfor_tekton_pipelines to wait for the operator to be ready
install_tekton_pipelines() {
  local display_name="tekton-pipelines-webhook"
  if oc get pods -n "tekton-pipelines" | grep -q "${display_name}"; then
    log::info "Tekton Pipelines are already installed."
  else
    log::info "Tekton Pipelines is not installed. Installing..."
    kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
  fi
}

waitfor_tekton_pipelines() {
  local display_name="tekton-pipelines-webhook"
  wait_for_deployment "tekton-pipelines" "${display_name}"
  wait_for_endpoint "tekton-pipelines-webhook" "tekton-pipelines"
  k8s_wait::crd "pipelines.tekton.dev" 120 5 || return 1
}

delete_tekton_pipelines() {
  log::info "Checking for Tekton Pipelines installation..."
  if ! kubectl get namespace tekton-pipelines &> /dev/null; then
    log::info "Tekton Pipelines is not installed. Nothing to delete."
    return 0
  fi

  log::info "Found Tekton Pipelines installation. Attempting to delete..."
  kubectl delete -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml --ignore-not-found=true 2> /dev/null || true

  # Wait for namespace deletion with polling
  log::info "Waiting for Tekton Pipelines namespace to be deleted..."
  if common::poll_until \
    "! kubectl get namespace tekton-pipelines" \
    6 5 \
    "Tekton Pipelines deleted successfully"; then
    return 0
  fi
  log::warn "Timed out waiting for namespace deletion, continuing..."
}

# ==============================================================================
# Cluster Setup Functions
# These functions configure the cluster for different deployment types
# Orchestrator functions are delegated to lib/orchestrator.sh
# ==============================================================================

install_orchestrator_infra_chart() {
  orchestrator::install_infra_chart
  return $?
}

deploy_orchestrator_workflows() {
  orchestrator::deploy_workflows "$@"
  return $?
}

deploy_orchestrator_workflows_operator() {
  orchestrator::deploy_workflows_operator "$@"
  return $?
}

enable_orchestrator_plugins_op() {
  orchestrator::enable_plugins_operator "$@"
  return $?
}

cluster_setup_ocp_helm() {
  operator::install_pipelines

  # Wait for OpenShift Pipelines to be ready before proceeding
  log::info "Waiting for OpenShift Pipelines to be ready..."
  k8s_wait::deployment "${OPERATOR_NAMESPACE}" "pipelines" 30 10 || return 1
  k8s_wait::endpoint "${TEKTON_PIPELINES_WEBHOOK}" "openshift-pipelines" 1800 10 || return 1

  operator::install_postgres_ocp

  # Skip orchestrator infra installation based on job type (see should_skip_orchestrator)
  if should_skip_orchestrator; then
    echo "Skipping orchestrator-infra installation on this job: ${JOB_NAME}"
  else
    install_orchestrator_infra_chart
  fi
}

cluster_setup_ocp_operator() {
  operator::install_pipelines

  # Wait for OpenShift Pipelines to be ready before proceeding
  log::info "Waiting for OpenShift Pipelines to be ready..."
  k8s_wait::deployment "${OPERATOR_NAMESPACE}" "pipelines" 30 10 || return 1
  k8s_wait::endpoint "${TEKTON_PIPELINES_WEBHOOK}" "openshift-pipelines" 1800 10 || return 1

  operator::install_postgres_ocp
  operator::install_serverless
  operator::install_serverless_logic
}

cluster_setup_k8s_operator() {
  operator::install_olm
  # Tekton not installed for K8s deployments (AKS/EKS/GKE)
  # Tekton tests are not executed in showcase-k8s or showcase-rbac-k8s projects
  # operator::install_tekton
  # operator::install_postgres_k8s # Works with K8s but disabled in values file
}

cluster_setup_k8s_helm() {
  # Tekton not installed for K8s deployments (AKS/EKS/GKE)
  # Tekton tests are not executed in showcase-k8s or showcase-rbac-k8s projects
  log::info "Skipping Tekton installation for K8s Helm deployment"
  # operator::install_olm
  # operator::install_tekton
  # operator::install_postgres_k8s # Works with K8s but disabled in values file
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

# ==============================================================================
# FUTURE MODULE: lib/deployment.sh
# Functions: base_deployment, rbac_deployment, initiate_deployments,
#            base_deployment_osd_gcp, rbac_deployment_osd_gcp, initiate_deployments_osd_gcp,
#            initiate_upgrade_base_deployments, initiate_upgrade_deployments,
#            initiate_runtime_deployment, initiate_sanity_plugin_checks_deployment,
#            apply_yaml_files, deploy_test_backstage_customization_provider,
#            deploy_redis_cache, configure_external_postgres_db
# ==============================================================================

base_deployment() {
  configure_namespace ${NAME_SPACE}

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}"
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  if should_skip_orchestrator; then
    local merged_pr_value_file="/tmp/merged-values_showcase_PR.yaml"
    yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase_PR.yaml" "${merged_pr_value_file}"
    disable_orchestrator_plugins_in_values "${merged_pr_value_file}"

    mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE}"
    cp -a "${merged_pr_value_file}" "${ARTIFACT_DIR}/${NAME_SPACE}/" || true
    # shellcheck disable=SC2046
    helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
      "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
      -f "${merged_pr_value_file}" \
      --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
      $(get_image_helm_set_params)
  else
    perform_helm_install "${RELEASE_NAME}" "${NAME_SPACE}" "${HELM_CHART_VALUE_FILE_NAME}"
  fi

  if should_skip_orchestrator; then
    log::warn "Skipping orchestrator workflows deployment on PR job: ${JOB_NAME}"
  else
    deploy_orchestrator_workflows "${NAME_SPACE}"
  fi
}

rbac_deployment() {
  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  # Wait for PostgreSQL to be fully ready before deploying RBAC instance
  # This ensures the sonataflow database creation job can connect immediately
  log::info "Waiting for external PostgreSQL to be ready..."
  if ! k8s_wait::deployment "${NAME_SPACE_POSTGRES_DB}" "postgress-external-db" 10 10; then
    log::error "PostgreSQL deployment failed to become ready"
    return 1
  fi

  # Initiate rbac instance deployment.
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"
  if should_skip_orchestrator; then
    local merged_pr_rbac_value_file="/tmp/merged-values_showcase-rbac_PR.yaml"
    yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase-rbac_PR.yaml" "${merged_pr_rbac_value_file}"
    disable_orchestrator_plugins_in_values "${merged_pr_rbac_value_file}"

    mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
    cp -a "${merged_pr_rbac_value_file}" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" || true
    # shellcheck disable=SC2046
    helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
      "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
      -f "${merged_pr_rbac_value_file}" \
      --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
      $(get_image_helm_set_params)
  else
    perform_helm_install "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${HELM_CHART_RBAC_VALUE_FILE_NAME}"
  fi

  # NOTE: This is a workaround to allow the sonataflow platform to connect to the external postgres db using ssl.
  if should_skip_orchestrator; then
    log::warn "Skipping sonataflow (orchestrator) external DB SSL workaround on PR job: ${JOB_NAME}"
  else
    # Wait for the sonataflow database creation job to complete with robust error handling
    if ! wait_for_job_completion "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}-create-sonataflow-database" 10 10; then
      echo "❌ Failed to create sonataflow database. Aborting RBAC deployment."
      return 1
    fi
    oc -n "${NAME_SPACE_RBAC}" patch sfp sonataflow-platform --type=merge \
      -p '{"spec":{"services":{"jobService":{"podTemplate":{"container":{"env":[{"name":"QUARKUS_DATASOURCE_REACTIVE_POSTGRESQL_SSL_MODE","value":"allow"},{"name":"QUARKUS_DATASOURCE_REACTIVE_TRUST_ALL","value":"true"}]}}}}}}'
    oc rollout restart deployment/sonataflow-platform-jobs-service -n "${NAME_SPACE_RBAC}"
  fi

  # initiate orchestrator workflows deployment
  if should_skip_orchestrator; then
    log::warn "Skipping orchestrator workflows deployment on PR job: ${JOB_NAME}"
  else
    deploy_orchestrator_workflows "${NAME_SPACE_RBAC}"
  fi
}

initiate_deployments() {
  cd "${DIR}"
  base_deployment
  rbac_deployment
}

# OSD-GCP specific deployment functions that merge diff files and skip orchestrator workflows
base_deployment_osd_gcp() {
  configure_namespace ${NAME_SPACE}

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}"
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  # Merge base values with OSD-GCP diff file
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase_OSD-GCP.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE}"
  cp -a "/tmp/merged-values_showcase_OSD-GCP.yaml" "${ARTIFACT_DIR}/${NAME_SPACE}/" # Save the final value-file into the artifacts directory.

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged-values_showcase_OSD-GCP.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)

  # Skip orchestrator workflows deployment for OSD-GCP
  log::warn "Skipping orchestrator workflows deployment on OSD-GCP environment"
}

rbac_deployment_osd_gcp() {
  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  # Initiate rbac instance deployment.
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"

  # Merge RBAC values with OSD-GCP diff file
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
  cp -a "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" # Save the final value-file into the artifacts directory.

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"

  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)

  # Skip orchestrator workflows deployment for OSD-GCP
  log::warn "Skipping orchestrator workflows deployment on OSD-GCP RBAC environment"
}

initiate_deployments_osd_gcp() {
  cd "${DIR}"
  base_deployment_osd_gcp
  rbac_deployment_osd_gcp
}

# install base RHDH deployment before upgrade
initiate_upgrade_base_deployments() {
  local release_name=$1
  local namespace=$2
  local url=$3
  local max_attempts=${4:-30} # Default to 30 if not set
  local wait_seconds=${5:-30}

  log::info "Initiating base RHDH deployment before upgrade"

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"

  configure_namespace "${namespace}"

  deploy_redis_cache "${namespace}"

  cd "${DIR}"

  apply_yaml_files "${DIR}" "${namespace}" "${url}"
  log::info "Deploying image from base repository: ${QUAY_REPO_BASE}, TAG_NAME_BASE: ${TAG_NAME_BASE}, in NAME_SPACE: ${namespace}"

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

  log::info "Initiating upgrade deployment"
  cd "${DIR}"

  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase_upgrade.yaml" "/tmp/merged_value_file.yaml"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

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
  local playwright_project=$3
  local url=$4
  local max_attempts=${5:-30} # Default to 30 if not set
  local wait_seconds=${6:-30} # Default to 30 if not set

  if check_backstage_running "${release_name}" "${namespace}" "${url}" "${max_attempts}" "${wait_seconds}"; then
    echo "Display pods for verification..."
    oc get pods -n "${namespace}"
    if [[ "${SKIP_TESTS:-false}" == "true" ]]; then
      log::info "SKIP_TESTS=true, skipping test execution for namespace: ${namespace}"
    else
      run_tests "${release_name}" "${namespace}" "${playwright_project}" "${url}"
    fi
  else
    echo "Backstage is not running. Marking deployment as failed and continuing..."
    CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
    save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT true
    save_status_test_failed $CURRENT_DEPLOYMENT true
    save_overall_result 1
  fi
  save_all_pod_logs "$namespace"
}

check_upgrade_and_test() {
  local deployment_name="$1"
  local release_name="$2"
  local namespace="$3"
  local playwright_project="$4"
  local url=$5
  local timeout=${6:-600} # Timeout in seconds (default: 600 seconds)

  if check_helm_upgrade "${deployment_name}" "${namespace}" "${timeout}"; then
    check_and_test "${release_name}" "${namespace}" "${playwright_project}" "${url}"
  else
    log::error "Helm upgrade encountered an issue or timed out. Exiting..."
    CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
    save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"
    save_status_failed_to_deploy $CURRENT_DEPLOYMENT true
    save_status_test_failed $CURRENT_DEPLOYMENT true
    save_overall_result 1
  fi
}

check_helm_upgrade() {
  local deployment_name="$1"
  local namespace="$2"
  local timeout="$3"

  log::info "Checking rollout status for deployment: ${deployment_name} in namespace: ${namespace}..."

  if oc rollout status "deployment/${deployment_name}" -n "${namespace}" --timeout="${timeout}s" -w; then
    log::info "RHDH upgrade is complete."
    return 0
  else
    log::error "RHDH upgrade encountered an issue or timed out."
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
      log::warn "Timeout: Namespace '${project}' was not deleted within $timeout_seconds seconds." >&2
      return 1
    fi
    sleep $sleep_interval
    elapsed=$((elapsed + sleep_interval))
  done

  log::success "Namespace '${project}' successfully deleted."
}

# ==============================================================================
# Common Functions - Delegate to lib/common.sh
# ==============================================================================
oc_login() { common::oc_login "$@"; }

is_openshift() {
  oc get routes.route.openshift.io &> /dev/null || kubectl get routes.route.openshift.io &> /dev/null
}

sed_inplace() { common::sed_inplace "$@"; }

get_previous_release_version() { common::get_previous_release_version "$@"; }

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
    log::error "Failed to determine previous release version." >&2
    save_overall_result 1
    exit 1
  fi

  log::info "Using previous release version: ${previous_release_version}" >&2

  # Construct the GitHub URL for the value file
  local github_url="https://raw.githubusercontent.com/redhat-developer/rhdh/release-${previous_release_version}/.ibm/pipelines/value_files/values_${value_file_type}.yaml"

  # Create a temporary file path for the downloaded value file
  local temp_value_file="/tmp/values_${value_file_type}_${previous_release_version}.yaml"

  echo "Fetching value file from: ${github_url}" >&2

  # Download the value file from GitHub
  if curl -fsSL "${github_url}" -o "${temp_value_file}"; then
    log::success "Successfully downloaded value file to: ${temp_value_file}" >&2
    log::info "${temp_value_file}"
  else
    log::error "Failed to download value file from GitHub." >&2
    save_overall_result 1
    exit 1
  fi
}

# Helper function to wait for backstage resource to exist in namespace
wait_for_backstage_resource() {
  local namespace=$1
  local max_attempts=40 # 40 attempts * 15 seconds = 10 minutes
  local sleep_interval=15

  log::info "Waiting for backstage resource to exist in namespace: $namespace"

  if ! common::poll_until \
    "[[ \$(oc get backstage -n '$namespace' -o json | jq '.items | length') -gt 0 ]]" \
    "$max_attempts" "$sleep_interval" \
    "Backstage resource found in namespace: $namespace"; then
    log::error "Error: No backstage resource found after 10 minutes"
    return 1
  fi
  return 0
}
