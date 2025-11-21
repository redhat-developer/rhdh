#!/bin/bash
# shellcheck disable=SC2155
# Kubernetes/OpenShift utilities for RHDH CI/CD Pipeline

# Prevent double sourcing
if [[ -n "${__CORE_K8S_SH_LOADED__:-}" ]]; then
  return 0
fi
export __CORE_K8S_SH_LOADED__=1

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# ============================================================================
# Pod Log Management
# ============================================================================

# Retrieve logs for a specific container in a pod
# Usage: retrieve_pod_logs <pod_name> <container> <namespace>
retrieve_pod_logs() {
  local pod_name=$1
  local container=$2
  local namespace=$3
  
  log_info "Retrieving logs for container: ${container} in pod: ${pod_name}"
  
  # Current logs
  kubectl logs "${pod_name}" -c "${container}" -n "${namespace}" \
    > "pod_logs/${pod_name}_${container}.log" || {
    log_warning "Current logs for container ${container} not found"
  }
  
  # Previous logs (if container restarted)
  kubectl logs "${pod_name}" -c "${container}" -n "${namespace}" --previous \
    > "pod_logs/${pod_name}_${container}-previous.log" 2> /dev/null || {
    log_debug "Previous logs for container ${container} not found"
    rm -f "pod_logs/${pod_name}_${container}-previous.log"
  }
}

# Save logs from all pods in a namespace
# Usage: save_all_pod_logs <namespace>
save_all_pod_logs() {
  set +e
  local namespace=$1
  
  log_info "Saving logs for all pods in namespace: ${namespace}"
  
  rm -rf pod_logs && mkdir -p pod_logs
  
  # Get all pod names in the namespace
  local pod_names=$(kubectl get pods -n "${namespace}" -o jsonpath='{.items[*].metadata.name}')
  
  for pod_name in ${pod_names}; do
    log_debug "Processing pod: ${pod_name}"
    
    # Retrieve init container logs
    local init_containers=$(kubectl get pod "${pod_name}" -n "${namespace}" \
      -o jsonpath='{.spec.initContainers[*].name}')
    for init_container in ${init_containers}; do
      retrieve_pod_logs "${pod_name}" "${init_container}" "${namespace}"
    done
    
    # Retrieve regular container logs
    local containers=$(kubectl get pod "${pod_name}" -n "${namespace}" \
      -o jsonpath='{.spec.containers[*].name}')
    for container in ${containers}; do
      retrieve_pod_logs "${pod_name}" "${container}" "${namespace}"
    done
  done
  
  # Copy logs to artifact directory
  mkdir -p "${ARTIFACT_DIR}/${namespace}/pod_logs"
  cp -a pod_logs/* "${ARTIFACT_DIR}/${namespace}/pod_logs" 2>/dev/null || true
  
  log_success "Pod logs saved to ${ARTIFACT_DIR}/${namespace}/pod_logs"
  set -e
}

# ============================================================================
# YAML File Merging
# ============================================================================

# Merge Helm value files using yq
# Usage: yq_merge_value_files <plugin_operation> <base_file> <diff_file> <final_file>
# plugin_operation: "merge" or "overwrite"
yq_merge_value_files() {
  local plugin_operation=$1
  local base_file=$2
  local diff_file=$3
  local final_file=$4
  local step_1_file="/tmp/step-without-plugins.yaml"
  local step_2_file="/tmp/step-only-plugins.yaml"
  
  log_info "Merging value files: ${base_file} + ${diff_file} -> ${final_file}"
  log_debug "Plugin operation: ${plugin_operation}"
  
  if [[ "${plugin_operation}" == "merge" ]]; then
    # Step 1: Merge files, excluding the .global.dynamic.plugins key
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1) |
      del(.global.dynamic.plugins)
    ' "${base_file}" "${diff_file}" > "${step_1_file}"
    
    # Step 2: Merge files, combining the .global.dynamic.plugins key
    yq eval-all '
      select(fileIndex == 0) *+ select(fileIndex == 1) |
      .global.dynamic.plugins |= (reverse | unique_by(.package) | reverse)
    ' "${base_file}" "${diff_file}" > "${step_2_file}"
    
    # Step 3: Combine results and remove null values
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1) | del(.. | select(. == null))
    ' "${step_2_file}" "${step_1_file}" > "${final_file}"
  elif [[ "${plugin_operation}" == "overwrite" ]]; then
    yq eval-all '
      select(fileIndex == 0) * select(fileIndex == 1)
    ' "${base_file}" "${diff_file}" > "${final_file}"
  else
    log_error "Invalid plugin operation: ${plugin_operation}"
    return 1
  fi
  
  log_success "Value files merged successfully"
}

# ============================================================================
# Resource Waiting Functions
# ============================================================================

# Wait for a deployment to become ready
# Usage: wait_for_deployment <namespace> <resource_name> [timeout_minutes] [check_interval_seconds]
wait_for_deployment() {
  local namespace=$1
  local resource_name=$2
  local timeout_minutes=${3:-5}
  local check_interval=${4:-10}
  
  if [[ -z "${namespace}" || -z "${resource_name}" ]]; then
    log_error "Missing required parameters: namespace and resource_name"
    return 1
  fi
  
  local max_attempts=$((timeout_minutes * 60 / check_interval))
  
  log_info "Waiting for '${resource_name}' in namespace '${namespace}' (timeout: ${timeout_minutes}m)"
  
  for ((i = 1; i <= max_attempts; i++)); do
    # Get the first pod name matching the resource name
    local pod_name=$(oc get pods -n "${namespace}" 2>/dev/null | \
      grep "${resource_name}" | awk '{print $1}' | head -n 1 || true)
    
    if [[ -n "${pod_name}" ]]; then
      # Check if pod's Ready condition is True
      local is_ready=$(oc get pod "${pod_name}" -n "${namespace}" \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
      
      # Verify pod is both Ready and Running
      if [[ "${is_ready}" == "True" ]] && \
         oc get pod "${pod_name}" -n "${namespace}" | grep -q "Running"; then
        log_success "Pod '${pod_name}' is running and ready"
        return 0
      else
        log_debug "Pod '${pod_name}' is not ready (Ready: ${is_ready})"
      fi
    else
      log_debug "No pods found matching '${resource_name}' in namespace '${namespace}'"
    fi
    
    log_debug "Still waiting... (${i}/${max_attempts} checks)"
    sleep "${check_interval}"
  done
  
  # Timeout occurred
  log_error "Timeout waiting for resource to be ready"
  log_info "Check with: oc get pods -n ${namespace} | grep ${resource_name}"
  return 1
}

# Wait for a service to be created
# Usage: wait_for_svc <svc_name> <namespace> [timeout_seconds]
wait_for_svc() {
  local svc_name=$1
  local namespace=$2
  local timeout=${3:-300}
  
  log_info "Waiting for service: ${svc_name} in namespace: ${namespace}"
  
  timeout "${timeout}" bash -c "
    while ! oc get svc ${svc_name} -n ${namespace} &> /dev/null; do
      echo 'Waiting for ${svc_name} service to be created...'
      sleep 5
    done
    echo 'Service ${svc_name} is created.'
  " || log_error "Timed out waiting for ${svc_name} service creation"
}

# Wait for an endpoint to be created
# Usage: wait_for_endpoint <endpoint_name> <namespace> [timeout_seconds]
wait_for_endpoint() {
  local endpoint_name=$1
  local namespace=$2
  local timeout=${3:-500}
  
  log_info "Waiting for endpoint: ${endpoint_name} in namespace: ${namespace}"
  
  timeout "${timeout}" bash -c "
    while ! kubectl get endpoints ${endpoint_name} -n ${namespace} &> /dev/null; do
      echo 'Waiting for ${endpoint_name} endpoint to be created...'
      sleep 5
    done
    echo 'Endpoint ${endpoint_name} is created.'
  " || log_error "Timed out waiting for ${endpoint_name} endpoint creation"
}

# ============================================================================
# Namespace Management
# ============================================================================

# Configure (delete and recreate) a namespace
# Usage: configure_namespace <namespace>
configure_namespace() {
  local project=$1
  
  log_info "Configuring namespace: ${project}"
  delete_namespace "${project}"
  
  if ! oc create namespace "${project}"; then
    log_error "Failed to create namespace ${project}"
    return 1
  fi
  
  if ! oc config set-context --current --namespace="${project}"; then
    log_error "Failed to set context for namespace ${project}"
    return 1
  fi
  
  log_success "Namespace ${project} is ready"
}

# Delete a namespace
# Usage: delete_namespace <namespace>
delete_namespace() {
  local project=$1
  
  if ! oc get namespace "${project}" > /dev/null 2>&1; then
    log_debug "Namespace ${project} does not exist"
    return 0
  fi
  
  log_info "Deleting namespace: ${project}"
  
  # Attempt to delete the namespace
  oc delete namespace "${project}" --grace-period=0 --force || true
  
  # Check if namespace is stuck in 'Terminating'
  if oc get namespace "${project}" -o jsonpath='{.status.phase}' 2>/dev/null | grep -q 'Terminating'; then
    log_warning "Namespace ${project} is stuck in Terminating. Forcing deletion..."
    force_delete_namespace "${project}"
  fi
}

# Forcibly delete a namespace stuck in 'Terminating' status
# Usage: force_delete_namespace <namespace> [timeout_seconds]
force_delete_namespace() {
  local project=$1
  local timeout_seconds=${2:-120}
  
  log_info "Forcefully deleting namespace ${project}"
  
  oc get namespace "${project}" -o json | \
    jq '.spec = {"finalizers":[]}' | \
    oc replace --raw "/api/v1/namespaces/${project}/finalize" -f -
  
  local elapsed=0
  local sleep_interval=2
  
  while oc get namespace "${project}" &> /dev/null; do
    if [[ ${elapsed} -ge ${timeout_seconds} ]]; then
      log_error "Timeout: Namespace '${project}' was not deleted within ${timeout_seconds} seconds"
      return 1
    fi
    sleep ${sleep_interval}
    elapsed=$((elapsed + sleep_interval))
  done
  
  log_success "Namespace '${project}' successfully deleted"
}

# Remove finalizers from resources in a namespace
# Usage: remove_finalizers_from_resources <namespace>
remove_finalizers_from_resources() {
  local project=$1
  
  log_info "Removing finalizers from resources in namespace ${project}"
  
  # Remove finalizers from stuck PipelineRuns and TaskRuns
  for resource_type in "pipelineruns.tekton.dev" "taskruns.tekton.dev"; do
    for resource in $(oc get "${resource_type}" -n "${project}" -o name 2>/dev/null); do
      oc patch "${resource}" -n "${project}" --type='merge' -p '{"metadata":{"finalizers":[]}}' || true
      log_debug "Removed finalizers from ${resource}"
    done
  done
  
  # Check and remove specific finalizers stuck on 'chains.tekton.dev' resources
  for chain_resource in $(oc get pipelineruns.tekton.dev,taskruns.tekton.dev -n "${project}" -o name 2>/dev/null); do
    oc patch "${chain_resource}" -n "${project}" --type='json' \
      -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
    log_debug "Removed Tekton finalizers from ${chain_resource}"
  done
}

# ============================================================================
# Secret Management
# ============================================================================

# Create a dockerconfigjson secret
# Usage: create_secret_dockerconfigjson <namespace> <secret_name> <dockerconfigjson_value>
create_secret_dockerconfigjson() {
  local namespace=$1
  local secret_name=$2
  local dockerconfigjson_value=$3
  
  log_info "Creating dockerconfigjson secret ${secret_name} in namespace ${namespace}"
  
  kubectl apply -n "${namespace}" -f - << EOD
apiVersion: v1
kind: Secret
metadata:
  name: ${secret_name}
data:
  .dockerconfigjson: ${dockerconfigjson_value}
type: kubernetes.io/dockerconfigjson
EOD
}

# Add image pull secret to default service account
# Usage: add_image_pull_secret_to_namespace_default_serviceaccount <namespace> <secret_name>
add_image_pull_secret_to_namespace_default_serviceaccount() {
  local namespace=$1
  local secret_name=$2
  
  log_info "Adding image pull secret ${secret_name} to default service account"
  
  kubectl -n "${namespace}" patch serviceaccount default \
    -p "{\"imagePullSecrets\": [{\"name\": \"${secret_name}\"}]}"
}

# Setup image pull secret (create and add to service account)
# Usage: setup_image_pull_secret <namespace> <secret_name> <dockerconfigjson_value>
setup_image_pull_secret() {
  local namespace=$1
  local secret_name=$2
  local dockerconfigjson_value=$3
  
  log_info "Setting up image pull secret ${secret_name} in ${namespace} namespace"
  
  create_secret_dockerconfigjson "${namespace}" "${secret_name}" "${dockerconfigjson_value}"
  add_image_pull_secret_to_namespace_default_serviceaccount "${namespace}" "${secret_name}"
}

# ============================================================================
# Operator Management
# ============================================================================

# Create an OpenShift Operator subscription
# Usage: install_subscription <name> <namespace> <channel> <package> <source_name> <source_namespace>
install_subscription() {
  local name=$1
  local namespace=$2
  local channel=$3
  local package=$4
  local source_name=$5
  local source_namespace=$6
  
  log_info "Installing subscription: ${name} in namespace: ${namespace}"
  log_debug "Channel: ${channel}, Package: ${package}, Source: ${source_name}/${source_namespace}"
  
  # Ensure namespace exists
  oc create namespace "${namespace}" --dry-run=client -o yaml | oc apply -f -
  
  oc apply -f - << EOD
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  channel: ${channel}
  installPlanApproval: Automatic
  name: ${package}
  source: ${source_name}
  sourceNamespace: ${source_namespace}
EOD
}

# Check operator status
# Usage: check_operator_status [timeout_seconds] <namespace> <operator_name> [expected_status]
check_operator_status() {
  local timeout=${1:-300}
  local namespace=$2
  local operator_name=$3
  local expected_status=${4:-"Succeeded"}
  
  log_info "Checking status of operator '${operator_name}' in namespace '${namespace}'"
  log_debug "Expected status: ${expected_status}, Timeout: ${timeout}s"
  
  timeout "${timeout}" bash -c "
    while true; do
      CURRENT_PHASE=\$(oc get csv -n '${namespace}' \
        -o jsonpath='{.items[?(@.spec.displayName==\"${operator_name}\")].status.phase}')
      echo \"Operator '${operator_name}' current phase: \${CURRENT_PHASE}\"
      [[ \"\${CURRENT_PHASE}\" == \"${expected_status}\" ]] && \
        echo \"Operator '${operator_name}' is now in '${expected_status}' phase.\" && break
      sleep 10
    done
  " || log_error "Timed out after ${timeout}s. Operator '${operator_name}' did not reach '${expected_status}' phase"
}

# ============================================================================
# OLM Management
# ============================================================================

# Install Operator Lifecycle Manager
# Usage: install_olm
install_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    log_info "OLM is already installed"
  else
    log_info "OLM is not installed. Installing..."
    operator-sdk olm install
  fi
}

# Uninstall Operator Lifecycle Manager
# Usage: uninstall_olm
uninstall_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    log_info "OLM is installed. Uninstalling..."
    operator-sdk olm uninstall
  else
    log_info "OLM is not installed. Nothing to uninstall"
  fi
}

# ============================================================================
# Helm Management
# ============================================================================

# Uninstall a Helm chart if it exists
# Usage: uninstall_helmchart <namespace> <release_name>
uninstall_helmchart() {
  local project=$1
  local release=$2
  
  if helm list -n "${project}" | grep -q "${release}"; then
    log_info "Chart ${release} exists. Removing it before install"
    helm uninstall "${release}" -n "${project}"
  fi
}

# ============================================================================
# ConfigMap Management
# ============================================================================

# Create app-config ConfigMap
# Usage: create_app_config_map <config_file> <namespace>
create_app_config_map() {
  local config_file=$1
  local project=$2
  
  log_info "Creating app-config ConfigMap in namespace: ${project}"
  
  oc create configmap app-config-rhdh \
    --from-file="app-config-rhdh.yaml=${config_file}" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -
}

# Create dynamic plugins config
# Usage: create_dynamic_plugins_config <base_file> <final_file>
create_dynamic_plugins_config() {
  local base_file=$1
  local final_file=$2
  
  log_info "Creating dynamic plugins ConfigMap"
  
  echo "kind: ConfigMap
apiVersion: v1
metadata:
  name: dynamic-plugins
data:
  dynamic-plugins.yaml: |" > "${final_file}"
  yq '.global.dynamic' "${base_file}" | sed -e 's/^/    /' >> "${final_file}"
}

# ============================================================================
# Platform Detection
# ============================================================================

# Login to OpenShift cluster
# Usage: oc_login
oc_login() {
  log_info "Logging into OpenShift cluster"
  
  oc login --token="${K8S_CLUSTER_TOKEN}" \
    --server="${K8S_CLUSTER_URL}" \
    --insecure-skip-tls-verify=true
  
  log_success "Logged into OpenShift cluster"
  log_info "OCP version: $(oc version)"
}

# Check if running on OpenShift
# Usage: is_openshift
is_openshift() {
  oc get routes.route.openshift.io &> /dev/null || \
    kubectl get routes.route.openshift.io &> /dev/null
}

# ============================================================================
# Encoding Utilities
# ============================================================================

# Encode string to base64 (single line, no wrapping)
# Usage: encode_base64 <string>
encode_base64() {
  local value="$1"
  echo -n "${value}" | base64 | tr -d '\n'
}

# Encode string to base64 with wrapping disabled (-w 0 for Linux)
# Usage: encode_base64_nowrap <string>
encode_base64_nowrap() {
  local value="$1"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS doesn't have -w flag, but doesn't wrap by default
    echo -n "${value}" | base64
  else
    # Linux with -w 0
    echo -n "${value}" | base64 | tr -d '\n'
  fi
}

# Decode base64 to string
# Usage: decode_base64 <encoded_string>
decode_base64() {
  local encoded="$1"
  echo -n "${encoded}" | base64 --decode
}

# ============================================================================
# Cross-Platform Utilities
# ============================================================================

# Cross-platform sed (works on both Linux and macOS)
# Usage: sed_inplace <sed_args>
sed_inplace() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "$@"
  else
    # Linux
    sed -i "$@"
  fi
}

# ============================================================================
# Export Functions
# ============================================================================
export -f retrieve_pod_logs
export -f save_all_pod_logs
export -f yq_merge_value_files
export -f wait_for_deployment
export -f wait_for_svc
export -f wait_for_endpoint
export -f configure_namespace
export -f delete_namespace
export -f force_delete_namespace
export -f remove_finalizers_from_resources
export -f create_secret_dockerconfigjson
export -f add_image_pull_secret_to_namespace_default_serviceaccount
export -f setup_image_pull_secret
export -f install_subscription
export -f check_operator_status
export -f install_olm
export -f uninstall_olm
export -f uninstall_helmchart
export -f create_app_config_map
export -f create_dynamic_plugins_config
export -f oc_login
export -f is_openshift
export -f encode_base64
export -f encode_base64_nowrap
export -f decode_base64
export -f sed_inplace

