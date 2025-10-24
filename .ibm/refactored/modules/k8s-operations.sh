#!/usr/bin/env bash
#
# Kubernetes/OpenShift Operations Module
#

# Guard to prevent multiple sourcing
if [[ -n "${_K8S_OPERATIONS_LOADED:-}" ]]; then
    return 0
fi
readonly _K8S_OPERATIONS_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/tekton-topology.sh"
source "$(dirname "${BASH_SOURCE[0]}")/sealight.sh"
source "$(dirname "${BASH_SOURCE[0]}")/config-validation.sh"

oc_login() {
    # Check if already logged in and verify credentials match
    if oc whoami &>/dev/null; then
        local current_server=$(oc whoami --show-server 2>/dev/null)
        local current_user=$(oc whoami 2>/dev/null)

        # If we have explicit credentials, verify they match current session
        if [[ -n "${K8S_CLUSTER_TOKEN}" ]] && [[ -n "${K8S_CLUSTER_URL}" ]]; then
            if [[ "${current_server}" == "${K8S_CLUSTER_URL}" ]]; then
                log_info "Already logged into correct OpenShift cluster: ${K8S_CLUSTER_URL}"
                log_info "Current user: ${current_user}"
                return 0
            else
                log_info "Current session (${current_server}) differs from target (${K8S_CLUSTER_URL})"
                log_info "Re-authenticating with provided credentials"
            fi
        else
            log_info "Using existing OpenShift session"
            log_info "Current user: ${current_user}"
            log_info "Current server: ${current_server}"
            return 0
        fi
    fi

    # Login with explicit credentials if provided
    if [[ -n "${K8S_CLUSTER_TOKEN}" ]] && [[ -n "${K8S_CLUSTER_URL}" ]]; then
        log_info "Logging into OpenShift cluster: ${K8S_CLUSTER_URL}"
        oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true
        log_info "OCP version: $(oc version --client)"
    else
        log_error "No OpenShift credentials available (not logged in and no explicit credentials provided)"
        log_info "Please either:"
        log_info "  1. Set K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL environment variables, or"
        log_info "  2. Login to OpenShift using: oc login --server=<server-url> --token=<token>"
        return 1
    fi
}

configure_namespace() {
    local namespace="$1"

    log_info "Configuring namespace: ${namespace}"

    # Check if namespace exists and its status
    if kubectl get namespace "${namespace}" &> /dev/null; then
        local phase
        phase=$(kubectl get namespace "${namespace}" -o jsonpath='{.status.phase}' 2>/dev/null)

        if [[ "${phase}" == "Terminating" ]]; then
            log_warning "Namespace ${namespace} is terminating, waiting for deletion..."
            local max_wait=60
            local count=0

            while [[ $count -lt $max_wait ]]; do
                if ! kubectl get namespace "${namespace}" &> /dev/null; then
                    log_info "Namespace deleted, recreating..."
                    break
                fi
                sleep 2
                count=$((count + 2))
            done

            if [[ $count -ge $max_wait ]]; then
                log_error "Namespace ${namespace} stuck in terminating state"
                return 1
            fi
        else
            log_info "Namespace ${namespace} already exists and is active"
            kubectl config set-context --current --namespace="${namespace}"
            return 0
        fi
    fi

    # Create namespace if it doesn't exist
    kubectl create namespace "${namespace}"
    log_success "Created namespace: ${namespace}"

    # Set as current namespace
    kubectl config set-context --current --namespace="${namespace}"
}

delete_namespace() {
    local namespace="$1"
    local wait="${2:-false}"

    if [[ -z "${namespace}" ]]; then
        log_error "Namespace not specified"
        return 1
    fi

    if kubectl get namespace "${namespace}" &> /dev/null; then
        log_info "Deleting namespace: ${namespace}"

        # Force delete stuck resources if needed
        kubectl delete all --all -n "${namespace}" --timeout=30s 2>/dev/null || true

        # Delete the namespace
        kubectl delete namespace "${namespace}" --wait=false

        if [[ "${wait}" == "true" ]]; then
            log_info "Waiting for namespace ${namespace} to be fully deleted..."
            local max_wait=60
            local count=0

            while [[ $count -lt $max_wait ]]; do
                if ! kubectl get namespace "${namespace}" &> /dev/null; then
                    log_success "Namespace ${namespace} deleted"
                    return 0
                fi
                sleep 2
                count=$((count + 2))
            done

            log_warning "Namespace ${namespace} still exists after ${max_wait} seconds"
        else
            log_success "Namespace ${namespace} deletion initiated"
        fi
    else
        log_info "Namespace ${namespace} does not exist"
    fi
}

resource_exists() {
    local resource_type="$1"
    local resource_name="$2"
    local namespace="${3:-}"

    local cmd="kubectl get ${resource_type} ${resource_name}"
    [[ -n "${namespace}" ]] && cmd="${cmd} -n ${namespace}"

    if ${cmd} &> /dev/null; then
        return 0
    else
        return 1
    fi
}

wait_for_deployment() {
    local namespace="$1"
    local deployment="$2"
    local timeout="${3:-300}"

    log_info "Waiting for deployment ${deployment} in namespace ${namespace}"

    # First check if deployment exists
    local check_interval=10
    local elapsed=0

    while [[ $elapsed -lt $timeout ]]; do
        if ! kubectl get deployment "${deployment}" -n "${namespace}" &>/dev/null; then
            log_debug "Deployment ${deployment} does not exist yet, waiting..."
            sleep $check_interval
            elapsed=$((elapsed + check_interval))
            continue
        fi

        # Deployment exists, wait for it to be available
        local remaining=$((timeout - elapsed))
        if kubectl wait --for=condition=available \
            --timeout="${remaining}s" \
            deployment/"${deployment}" \
            -n "${namespace}" 2>/dev/null; then
            log_success "Deployment ${deployment} is ready"
            return 0
        else
            # Check if deployment has issues
            local replicas=$(kubectl get deployment "${deployment}" -n "${namespace}" -o jsonpath='{.status.replicas}' 2>/dev/null || echo "0")
            local ready=$(kubectl get deployment "${deployment}" -n "${namespace}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")

            log_warning "Deployment ${deployment}: ${ready}/${replicas} replicas ready"

            # Try to recover from common issues
            if attempt_deployment_recovery "${namespace}" "${deployment}"; then
                # Give it more time after recovery attempt
                elapsed=$((elapsed - 60))  # Add 60 seconds back
                if [[ $elapsed -lt 0 ]]; then
                    elapsed=0
                fi
                continue
            fi

            break
        fi
    done

    log_error "Deployment ${deployment} failed to become ready within ${timeout}s"
    kubectl get deployment "${deployment}" -n "${namespace}" || true
    kubectl describe deployment "${deployment}" -n "${namespace}" | tail -20 || true
    return 1
}

apply_yaml_files() {
    local directory="$1"
    local namespace="$2"
    local base_url="${3:-}"

    log_info "Applying YAML files from ${directory} to namespace ${namespace}"

    # Apply service accounts and RBAC resources
    local service_account_file="${directory}/resources/service_account/service-account-rhdh.yaml"
    if [[ -f "${service_account_file}" ]]; then
        log_debug "Applying service account"
        kubectl apply -f "${service_account_file}" -n "${namespace}"
    fi

    # Apply service account secret if exists
    if [[ -f "${directory}/auth/service-account-rhdh-secret.yaml" ]]; then
        kubectl apply -f "${directory}/auth/service-account-rhdh-secret.yaml" -n "${namespace}"
    fi

    # Apply cluster roles and bindings
    local cluster_roles_dir="${directory}/resources/cluster_role"
    if [[ -d "${cluster_roles_dir}" ]]; then
        for file in "${cluster_roles_dir}"/*.yaml; do
            [[ -f "$file" ]] || continue
            log_debug "Applying cluster role: $(basename "$file")"
            kubectl apply -f "$file"
        done
    fi

    local cluster_role_bindings_dir="${directory}/resources/cluster_role_binding"
    if [[ -d "${cluster_role_bindings_dir}" ]]; then
        for file in "${cluster_role_bindings_dir}"/*.yaml; do
            [[ -f "$file" ]] || continue
            # Update namespace in the file
            sed -i.bak "s/namespace:.*/namespace: ${namespace}/g" "$file" 2>/dev/null || \
                sed -i '' "s/namespace:.*/namespace: ${namespace}/g" "$file" 2>/dev/null || true
            log_debug "Applying cluster role binding: $(basename "$file")"
            kubectl apply -f "$file"
        done
    fi

    # Create rhdh-secrets secret with environment variables
    if [[ -f "${directory}/auth/secrets-rhdh-secrets.yaml" ]]; then
        log_debug "Creating rhdh-secrets from environment variables"

        # Get OCM token if available
        local OCM_CLUSTER_TOKEN=""
        if kubectl get secret rhdh-k8s-plugin-secret -n "${namespace}" &>/dev/null; then
            OCM_CLUSTER_TOKEN=$(kubectl get secret rhdh-k8s-plugin-secret -n "${namespace}" -o=jsonpath='{.data.token}' 2>/dev/null || true)
            export OCM_CLUSTER_TOKEN
        fi

        # Set base URLs and other required variables
        if [[ -n "${base_url}" ]]; then
            export RHDH_BASE_URL=$(echo -n "${base_url}" | base64 | tr -d '\n')
            export RHDH_BASE_URL_HTTP=$(echo -n "${base_url/https/http}" | base64 | tr -d '\n')
        fi

        # Set DH_TARGET_URL if not already set
        if [[ -z "${DH_TARGET_URL:-}" ]]; then
            export DH_TARGET_URL=$(echo -n "test-backstage-customization-provider-${namespace}.${K8S_CLUSTER_ROUTER_BASE}" | base64 -w 0 2>/dev/null || \
                                  echo -n "test-backstage-customization-provider-${namespace}.${K8S_CLUSTER_ROUTER_BASE}" | base64 | tr -d '\n')
        fi

        # Apply the secret with environment variable substitution
        envsubst < "${directory}/auth/secrets-rhdh-secrets.yaml" | kubectl apply -n "${namespace}" -f -
    fi

    # Apply other secrets
    local secrets_dir="${directory}/resources/secrets"
    if [[ -d "${secrets_dir}" ]]; then
        for file in "${secrets_dir}"/*.yaml; do
            [[ -f "$file" ]] || continue
            log_debug "Applying secret: $(basename "$file")"
            kubectl apply -f "$file" -n "${namespace}"
        done
    fi

    # Create ConfigMaps as in the original script
    local configmaps_dir="${directory}/resources/config_map"
    if [[ -d "${configmaps_dir}" ]]; then
        # Select the correct config file based on namespace/job
        local config_file=""
        if [[ "${namespace}" == *rbac* ]]; then
            config_file="${configmaps_dir}/app-config-rhdh-rbac.yaml"
        else
            config_file="${configmaps_dir}/app-config-rhdh.yaml"
        fi

        # Create app-config-rhdh ConfigMap from the selected file
        # Add helm.sh/resource-policy annotation to prevent Helm from managing it
        if [[ -f "${config_file}" ]]; then
            log_debug "Creating configmap app-config-rhdh from $(basename "${config_file}") with helm.sh/resource-policy annotation"
            kubectl create configmap app-config-rhdh \
                --from-file="app-config-rhdh.yaml"="${config_file}" \
                --namespace="${namespace}" \
                --dry-run=client -o yaml | \
                kubectl annotate -f - helm.sh/resource-policy=keep --local --dry-run=client -o yaml | \
                kubectl apply -f -

            # Apply configuration fixes after creating the ConfigMap
            apply_config_fixes "${namespace}" "app-config-rhdh"
        fi

        # Create dynamic-plugins-config from file content with environment variable substitution
        if [[ -f "${configmaps_dir}/dynamic-plugins-config.yaml" ]]; then
            log_debug "Creating configmap dynamic-plugins-config with environment variable substitution"
            # Process with envsubst to replace ${VAR} placeholders
            local processed_config
            processed_config=$(envsubst < "${configmaps_dir}/dynamic-plugins-config.yaml")
            
            kubectl create configmap dynamic-plugins-config \
                --from-literal="dynamic-plugins-config.yaml=${processed_config}" \
                --namespace="${namespace}" \
                --dry-run=client -o yaml | \
                kubectl annotate -f - helm.sh/resource-policy=keep --local --dry-run=client -o yaml | \
                kubectl apply -f -
        fi

        # Create dynamic-global-floating-action-button-config
        if [[ -f "${configmaps_dir}/dynamic-global-floating-action-button-config.yaml" ]]; then
            kubectl create configmap dynamic-global-floating-action-button-config \
                --from-file="dynamic-global-floating-action-button-config.yaml"="${configmaps_dir}/dynamic-global-floating-action-button-config.yaml" \
                --namespace="${namespace}" \
                --dry-run=client -o yaml | \
                kubectl annotate -f - helm.sh/resource-policy=keep --local --dry-run=client -o yaml | \
                kubectl apply -f -
        fi

        # Create dynamic-global-header-config
        if [[ -f "${configmaps_dir}/dynamic-global-header-config.yaml" ]]; then
            kubectl create configmap dynamic-global-header-config \
                --from-file="dynamic-global-header-config.yaml"="${configmaps_dir}/dynamic-global-header-config.yaml" \
                --namespace="${namespace}" \
                --dry-run=client -o yaml | \
                kubectl annotate -f - helm.sh/resource-policy=keep --local --dry-run=client -o yaml | \
                kubectl apply -f -
        fi

        # Create rbac-policy configmap
        if [[ -f "${configmaps_dir}/rbac-policy.csv" ]]; then
            kubectl create configmap rbac-policy \
                --from-file="rbac-policy.csv"="${configmaps_dir}/rbac-policy.csv" \
                --namespace="${namespace}" \
                --dry-run=client -o yaml | \
                kubectl annotate -f - helm.sh/resource-policy=keep --local --dry-run=client -o yaml | \
                kubectl apply -f -
        fi
    fi
}

# Create a ConfigMap from a template file using envsubst and annotate to keep Helm away
create_configmap_from_template() {
    local name="$1"
    local namespace="$2"
    local file_path="$3"
    local key_name="${4:-$(basename "$file_path")}"

    if [[ ! -f "$file_path" ]]; then
        log_error "ConfigMap template not found: $file_path"
        return 1
    fi

    log_info "Creating configmap ${name} from template ${file_path} (key=${key_name})"
    local processed
    processed=$(envsubst < "$file_path")

    kubectl create configmap "$name" \
        --from-literal="$key_name=$processed" \
        --namespace="$namespace" \
        --dry-run=client -o yaml | \
        kubectl annotate -f - helm.sh/resource-policy=keep --local --dry-run=client -o yaml | \
        kubectl apply -f -

    log_success "ConfigMap ${name} applied"
}

# Bulk delete kinds in a namespace in parallel (best effort)
bulk_delete() {
    local namespace="$1"
    shift
    local kinds=("$@")

    if [[ -z "$namespace" || ${#kinds[@]} -eq 0 ]]; then
        log_error "Usage: bulk_delete <namespace> <kind1> [kind2 ...]"
        return 1
    fi

    log_info "Bulk deleting resources in ${namespace}: ${kinds[*]}"
    for kind in "${kinds[@]}"; do
        (
            kubectl delete "$kind" --all -n "$namespace" --ignore-not-found --grace-period=0 --force 2>/dev/null || true
        ) &
    done
    wait || true
    log_success "Bulk delete completed in ${namespace}"
}

apply_with_retry() {
    local yaml_content="$1"
    local namespace="${2:-}"
    local max_retries="${3:-3}"
    local retry_delay="${4:-5}"

    local retry_count=0
    local cmd="kubectl apply"

    [[ -n "${namespace}" ]] && cmd="${cmd} -n ${namespace}"
    cmd="${cmd} -f -"

    while [[ $retry_count -lt $max_retries ]]; do
        if echo "${yaml_content}" | ${cmd} 2>/dev/null; then
            return 0
        fi

        retry_count=$((retry_count + 1))
        if [[ $retry_count -lt $max_retries ]]; then
            log_debug "Apply failed, retrying in ${retry_delay}s (attempt ${retry_count}/${max_retries})"
            sleep "${retry_delay}"
        fi
    done

    log_error "Failed to apply resource after ${max_retries} attempts"
    return 1
}

ensure_namespace_ready() {
    local namespace="$1"
    local max_wait="${2:-30}"

    local count=0
    while [[ $count -lt $max_wait ]]; do
        local phase
        phase=$(kubectl get namespace "${namespace}" -o jsonpath='{.status.phase}' 2>/dev/null)

        if [[ "${phase}" == "Active" ]]; then
            return 0
        fi

        sleep 1
        count=$((count + 1))
    done

    log_warning "Namespace ${namespace} not ready after ${max_wait} seconds"
    return 1
}

attempt_deployment_recovery() {
    local namespace="$1"
    local deployment="$2"

    log_info "Attempting to recover deployment ${deployment}"

    # The label selector should match the release name (e.g., rhdh for rhdh-developer-hub)
    local label_selector=""
    if [[ "${deployment}" == *"-developer-hub" ]]; then
        # Extract the release name from deployment name
        local release_name="${deployment%-developer-hub}"
        label_selector="app.kubernetes.io/instance=${release_name}"
    else
        # For other deployments, use the deployment name
        label_selector="app.kubernetes.io/instance=${deployment}"
    fi

    # Check for common issues
    local pods=$(kubectl get pods -n "${namespace}" -l "${label_selector}" --no-headers 2>/dev/null)

    # Check for ImagePullBackOff
    if echo "${pods}" | grep -q "ImagePullBackOff\|ErrImagePull"; then
        log_warning "Detected image pull issues, checking pull secrets..."

        # Ensure pull secret exists
        if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
            kubectl create secret docker-registry registry-pull-secret \
                --docker-server=registry.redhat.io \
                --from-file=.dockerconfigjson="${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}" \
                -n "${namespace}" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null || true

            # Restart pods to use new secret
            kubectl delete pods -n "${namespace}" -l "${label_selector}" --grace-period=30 2>/dev/null || true
            log_info "Restarted pods to pick up pull secret"
            return 0
        fi
    fi

    # Check for CrashLoopBackOff
    if echo "${pods}" | grep -q "CrashLoopBackOff\|Error"; then
        log_warning "Detected crashing pods, checking logs..."

        # Get logs from crashed pods
        local pod_name=$(echo "${pods}" | grep -E "CrashLoopBackOff|Error" | head -1 | awk '{print $1}')
        if [[ -n "${pod_name}" ]]; then
            log_debug "Logs from pod ${pod_name}:"
            kubectl logs "${pod_name}" -n "${namespace}" --tail=20 2>/dev/null || true

            # Check if it's a config issue
            if kubectl logs "${pod_name}" -n "${namespace}" 2>/dev/null | grep -q "config.*not found\|missing.*config"; then
                log_info "Detected configuration issue, reapplying configs..."
                apply_yaml_files "${DIR}" "${namespace}" ""
                kubectl rollout restart deployment "${deployment}" -n "${namespace}" 2>/dev/null || true
                return 0
            fi
        fi
    fi

    # Check for resource constraints
    if echo "${pods}" | grep -q "Pending"; then
        log_warning "Detected pending pods, checking resource constraints..."

        local pod_name=$(echo "${pods}" | grep "Pending" | head -1 | awk '{print $1}')
        if [[ -n "${pod_name}" ]]; then
            local events=$(kubectl describe pod "${pod_name}" -n "${namespace}" | grep -A5 "Events:")

            if echo "${events}" | grep -q "Insufficient\|FailedScheduling"; then
                log_warning "Insufficient cluster resources detected"

                # Try to scale down deployment
                local current_replicas=$(kubectl get deployment "${deployment}" -n "${namespace}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
                if [[ ${current_replicas} -gt 1 ]]; then
                    log_info "Scaling down deployment to reduce resource usage"
                    kubectl scale deployment "${deployment}" -n "${namespace}" --replicas=1
                    return 0
                fi
            fi
        fi
    fi

    log_info "No automatic recovery available for current issue"
    return 1
}

# ============================================================================
# INTEGRATED MODULE FUNCTIONS
# ============================================================================

setup_deployment_integrations() {
    local namespace="${1}"
    local job_name="${2:-${JOB_NAME}}"

    log_section "Setting up deployment integrations"

    # Fix base64 encoded URLs first
    fix_ocm_cluster_url

    # Setup Sealight if enabled
    if check_sealight_enabled; then
        log_info "Sealight integration enabled"
        setup_sealight_env_vars
        setup_sealight_image_pull_secret "${namespace}"
        initialize_sealight_reporting
    fi

    # Setup Tekton/Topology if requested
    if [[ "${ENABLE_TEKTON_TOPOLOGY:-false}" == "true" ]] || [[ "$job_name" == *"tekton"* ]]; then
        log_info "Tekton/Topology integration enabled"

        # Install Tekton if not present
        if ! check_tekton_installed; then
            install_tekton_pipelines
        fi

        # Deploy test resources
        deploy_tekton_test_resources "${namespace}"
        deploy_topology_test_app "${namespace}"

        # Apply cloud-specific patches if needed
        if [[ -n "${CLOUD_PROVIDER:-}" ]]; then
            patch_for_cloud_provider "${namespace}" "${CLOUD_PROVIDER}"
        fi

        # Verify integration
        verify_tekton_topology_integration "${namespace}"
    fi

    log_success "Deployment integrations setup complete"
}

cleanup_deployment_integrations() {
    local namespace="${1}"

    log_section "Cleaning up deployment integrations"

    # Cleanup Sealight reporting
    if check_sealight_enabled; then
        finalize_sealight_reporting
    fi

    # Cleanup Tekton/Topology resources
    if [[ "${ENABLE_TEKTON_TOPOLOGY:-false}" == "true" ]]; then
        cleanup_tekton_topology_resources "${namespace}"
    fi

    log_success "Integration cleanup complete"
}

# Export functions
export -f oc_login configure_namespace delete_namespace resource_exists
export -f wait_for_deployment apply_yaml_files apply_with_retry ensure_namespace_ready attempt_deployment_recovery
export -f setup_deployment_integrations cleanup_deployment_integrations