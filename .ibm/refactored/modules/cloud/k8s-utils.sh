#!/usr/bin/env bash
#
# Generic K8s Utilities Module
# Provides cloud-agnostic Kubernetes utility functions
#

# Guard to prevent multiple sourcing
if [[ -n "${_K8S_UTILS_LOADED:-}" ]]; then
    return 0
fi
readonly _K8S_UTILS_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"

# ============================================================================
# SERVICE ACCOUNT OPERATIONS
# ============================================================================

re_create_k8s_service_account_and_get_token() {
    local sa_namespace="${1:-default}"
    local sa_name="${2:-tester-sa-2}"
    local sa_binding_name="${sa_name}-binding"
    local sa_secret_name="${sa_name}-secret"
    local token

    log_info "Setting up Kubernetes service account: $sa_name in namespace: $sa_namespace" >&2

    # Try to get existing token first
    if token="$(kubectl get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"; then
        K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
        log_info "Acquired existing token for the service account" >&2
    else
        log_info "Creating new service account and token" >&2

        # Create service account if it doesn't exist
        if ! kubectl get serviceaccount ${sa_name} -n ${sa_namespace} &>/dev/null; then
            log_info "Creating service account ${sa_name}..." >&2
            kubectl create serviceaccount ${sa_name} -n ${sa_namespace}

            log_info "Creating cluster role binding..." >&2
            kubectl create clusterrolebinding ${sa_binding_name} \
                --clusterrole=cluster-admin \
                --serviceaccount=${sa_namespace}:${sa_name}

            log_success "Service account and binding created successfully" >&2
        else
            log_info "Service account ${sa_name} already exists in namespace ${sa_namespace}" >&2
        fi

        # Create secret for service account
        log_info "Creating secret for service account" >&2
        kubectl apply --namespace="${sa_namespace}" -f - << EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${sa_secret_name}
  namespace: ${sa_namespace}
  annotations:
    kubernetes.io/service-account.name: ${sa_name}
type: kubernetes.io/service-account-token
EOF

        # Wait for token to be generated
        sleep 5

        # Get the token
        token="$(kubectl get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"
        K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
        log_success "Acquired token for the service account" >&2
    fi

    # Export tokens in various formats for compatibility
    K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" "$K8S_CLUSTER_TOKEN" | base64 | tr -d '\n')
    K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
    OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED

    export K8S_CLUSTER_TOKEN K8S_CLUSTER_TOKEN_ENCODED K8S_SERVICE_ACCOUNT_TOKEN OCM_CLUSTER_TOKEN

    log_success "Service account tokens exported successfully" >&2
    return 0
}

# ============================================================================
# RESOURCE PATCHING OPERATIONS
# ============================================================================

patch_and_restart() {
    local namespace="$1"
    local resource_type="$2"
    local resource_name="$3"
    local patch_file="$4"

    if [[ -z "$namespace" || -z "$resource_type" || -z "$resource_name" || -z "$patch_file" ]]; then
        log_error "Usage: patch_and_restart <namespace> <resource_type> <resource_name> <patch_file>" >&2
        return 1
    fi

    if [[ ! -f "$patch_file" ]]; then
        log_error "Patch file not found: $patch_file" >&2
        return 1
    fi

    log_info "Waiting for $resource_type/$resource_name to be present..." >&2
    if ! kubectl wait --for=jsonpath='{.metadata.name}'="$resource_name" \
        "$resource_type/$resource_name" -n "$namespace" --timeout=60s; then
        log_error "Timeout waiting for $resource_type/$resource_name" >&2
        return 1
    fi

    log_info "Patching $resource_type/$resource_name in namespace $namespace with file $patch_file" >&2
    if ! kubectl patch "$resource_type" "$resource_name" -n "$namespace" \
        --type=merge --patch-file "$patch_file"; then
        log_error "Failed to patch $resource_type/$resource_name" >&2
        return 1
    fi

    log_info "Scaling down $resource_type/$resource_name to 0 replicas" >&2
    kubectl scale "$resource_type" "$resource_name" --replicas=0 -n "$namespace"

    log_info "Waiting for pods to terminate gracefully (timeout: 60s)..." >&2
    if ! kubectl wait --for=delete pods -l app="$resource_name" -n "$namespace" --timeout=60s; then
        log_warning "Pods did not terminate gracefully within 60s" >&2
        log_info "Attempting force deletion of pods..." >&2
        kubectl delete pods -l app="$resource_name" -n "$namespace" --force --grace-period=0
        # Wait a bit to ensure pods are actually gone
        sleep 5
    fi

    log_info "Scaling up $resource_type/$resource_name to 1 replica" >&2
    kubectl scale "$resource_type" "$resource_name" --replicas=1 -n "$namespace"

    log_success "Patch and restart completed for $resource_type/$resource_name" >&2
    return 0
}

# ============================================================================
# WAIT OPERATIONS
# ============================================================================

wait_for_rollout() {
    local namespace="$1"
    local resource_type="$2"
    local resource_name="$3"
    local timeout="${4:-300}"

    log_info "Waiting for rollout of $resource_type/$resource_name in namespace $namespace" >&2

    if kubectl rollout status "$resource_type/$resource_name" \
        -n "$namespace" --timeout="${timeout}s"; then
        log_success "Rollout completed successfully" >&2
        return 0
    else
        log_error "Rollout failed or timed out" >&2
        return 1
    fi
}

wait_for_pods_ready() {
    local namespace="$1"
    local label_selector="$2"
    local expected_count="${3:-1}"
    local timeout="${4:-300}"

    log_info "Waiting for $expected_count pod(s) with selector '$label_selector' to be ready" >&2

    local end_time=$(($(date +%s) + timeout))

    while [[ $(date +%s) -lt $end_time ]]; do
        local ready_count
        ready_count=$(kubectl get pods -n "$namespace" -l "$label_selector" \
            -o jsonpath='{.items[?(@.status.conditions[?(@.type=="Ready")].status=="True")].metadata.name}' \
            2>/dev/null | wc -w)

        if [[ $ready_count -ge $expected_count ]]; then
            log_success "All expected pods are ready ($ready_count/$expected_count)" >&2
            return 0
        fi

        log_debug "Pods ready: $ready_count/$expected_count, waiting..." >&2
        sleep 5
    done

    log_error "Timeout waiting for pods to be ready" >&2
    return 1
}

# ============================================================================
# INGRESS OPERATIONS
# ============================================================================

wait_for_ingress() {
    local namespace="$1"
    local ingress_name="$2"
    local timeout="${3:-300}"

    log_info "Waiting for ingress $ingress_name in namespace $namespace" >&2

    local end_time=$(($(date +%s) + timeout))

    while [[ $(date +%s) -lt $end_time ]]; do
        local address
        # Try to get hostname first (common for cloud load balancers)
        address=$(kubectl get ingress "$ingress_name" -n "$namespace" \
            -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)

        # If no hostname, try IP
        if [[ -z "$address" ]]; then
            address=$(kubectl get ingress "$ingress_name" -n "$namespace" \
                -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
        fi

        if [[ -n "$address" ]]; then
            log_success "Ingress is ready with address: $address" >&2
            echo "$address"
            return 0
        fi

        log_debug "Ingress not ready yet, waiting..." >&2
        sleep 10
    done

    log_error "Timeout waiting for ingress to be ready" >&2
    return 1
}

patch_ingress_for_cloud() {
    local namespace="$1"
    local ingress_name="$2"
    local cloud_provider="$3"

    log_info "Patching ingress $ingress_name for $cloud_provider" >&2

    case "$cloud_provider" in
        eks|aws)
            # Add AWS ALB annotations
            kubectl annotate ingress "$ingress_name" -n "$namespace" \
                kubernetes.io/ingress.class=alb \
                alb.ingress.kubernetes.io/scheme=internet-facing \
                alb.ingress.kubernetes.io/target-type=ip \
                --overwrite
            ;;
        gke|gcp)
            # Add GCP ingress annotations
            kubectl annotate ingress "$ingress_name" -n "$namespace" \
                kubernetes.io/ingress.class=gce \
                kubernetes.io/ingress.global-static-ip-name="${GKE_STATIC_IP_NAME:-}" \
                --overwrite
            ;;
        aks|azure)
            # Add Azure ingress annotations
            kubectl annotate ingress "$ingress_name" -n "$namespace" \
                kubernetes.io/ingress.class=azure/application-gateway \
                --overwrite
            ;;
        *)
            log_warning "Unknown cloud provider: $cloud_provider, skipping ingress patching" >&2
            ;;
    esac

    log_success "Ingress patched for $cloud_provider" >&2
    return 0
}

# ============================================================================
# NAMESPACE OPERATIONS
# ============================================================================

create_namespace_if_not_exists() {
    local namespace="$1"

    if kubectl get namespace "$namespace" &>/dev/null; then
        log_info "Namespace $namespace already exists" >&2
    else
        log_info "Creating namespace $namespace" >&2
        if kubectl create namespace "$namespace"; then
            log_success "Namespace $namespace created successfully" >&2
        else
            log_error "Failed to create namespace $namespace" >&2
            return 1
        fi
    fi
    return 0
}

# ============================================================================
# SECRET OPERATIONS
# ============================================================================

create_docker_registry_secret() {
    local namespace="$1"
    local secret_name="$2"
    local registry_url="$3"
    local username="$4"
    local password="$5"

    log_info "Creating docker registry secret: $secret_name" >&2

    if kubectl get secret "$secret_name" -n "$namespace" &>/dev/null; then
        log_info "Secret $secret_name already exists, updating..." >&2
        kubectl delete secret "$secret_name" -n "$namespace"
    fi

    kubectl create secret docker-registry "$secret_name" \
        --namespace="$namespace" \
        --docker-server="$registry_url" \
        --docker-username="$username" \
        --docker-password="$password"

    if [[ $? -eq 0 ]]; then
        log_success "Docker registry secret created successfully" >&2
        return 0
    else
        log_error "Failed to create docker registry secret" >&2
        return 1
    fi
}

# ============================================================================
# CLUSTER INFO OPERATIONS
# ============================================================================

get_cluster_api_server_url() {
    local url
    url=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null)

    if [[ -n "$url" ]]; then
        echo "$url"
        return 0
    else
        log_error "Failed to get cluster API server URL" >&2
        return 1
    fi
}

get_cluster_platform() {
    local server_url
    server_url=$(get_cluster_api_server_url)

    if [[ "$server_url" == *"eks.amazonaws.com"* ]]; then
        echo "eks"
    elif [[ "$server_url" == *"azmk8s.io"* ]]; then
        echo "aks"
    elif [[ "$server_url" == *"container.googleapis.com"* ]]; then
        echo "gke"
    elif kubectl get routes -n openshift-console &>/dev/null; then
        echo "openshift"
    else
        echo "k8s"
    fi
}

# Export functions
export -f re_create_k8s_service_account_and_get_token patch_and_restart
export -f wait_for_rollout wait_for_pods_ready wait_for_ingress patch_ingress_for_cloud
export -f create_namespace_if_not_exists create_docker_registry_secret
export -f get_cluster_api_server_url get_cluster_platform