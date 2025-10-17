#!/usr/bin/env bash
#
# Cloud Bootstrap Module
# Provides unified loading of cloud-specific modules
#

# Guard to prevent multiple sourcing
if [[ -n "${_CLOUD_BOOTSTRAP_LOADED:-}" ]]; then
    return 0
fi
readonly _CLOUD_BOOTSTRAP_LOADED=true

# Get the directory of this script
CLOUD_MODULES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${CLOUD_MODULES_DIR}/../logging.sh"

# ============================================================================
# CLOUD PROVIDER DETECTION
# ============================================================================

detect_cloud_provider() {
    local provider=""

    # Check environment variables first
    if [[ -n "${CLOUD_PROVIDER}" ]]; then
        provider="${CLOUD_PROVIDER}"
    elif [[ -n "${K8S_DISTRO}" ]]; then
        provider="${K8S_DISTRO}"
    else
        # Try to detect from cluster
        if command -v kubectl >/dev/null 2>&1; then
            local server_url
            server_url=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null)

            if [[ "$server_url" == *"eks.amazonaws.com"* ]]; then
                provider="eks"
            elif [[ "$server_url" == *"azmk8s.io"* ]]; then
                provider="aks"
            elif [[ "$server_url" == *"container.googleapis.com"* ]]; then
                provider="gke"
            elif kubectl get routes -n openshift-console &>/dev/null; then
                provider="openshift"
            else
                provider="k8s"
            fi
        fi
    fi

    echo "$provider"
}

# ============================================================================
# CLOUD MODULE LOADING
# ============================================================================

load_cloud_module() {
    local provider="${1:-$(detect_cloud_provider)}"

    log_info "Loading cloud modules for provider: $provider" >&2

    # Always load generic k8s utils
    source "${CLOUD_MODULES_DIR}/k8s-utils.sh"

    case "$provider" in
        aks|azure)
            log_info "Loading Azure/AKS cloud module" >&2
            source "${CLOUD_MODULES_DIR}/aks.sh"
            export CLOUD_PROVIDER="aks"
            ;;
        eks|aws)
            log_info "Loading AWS/EKS cloud module" >&2
            source "${CLOUD_MODULES_DIR}/eks.sh"
            export CLOUD_PROVIDER="eks"
            ;;
        gke|gcp)
            log_info "Loading GCP/GKE cloud module" >&2
            source "${CLOUD_MODULES_DIR}/gke.sh"
            export CLOUD_PROVIDER="gke"
            ;;
        openshift|ocp)
            log_info "OpenShift detected, using generic k8s utils" >&2
            export CLOUD_PROVIDER="openshift"
            ;;
        k8s|kubernetes|*)
            log_info "Generic Kubernetes, using k8s utils only" >&2
            export CLOUD_PROVIDER="k8s"
            ;;
    esac

    log_success "Cloud modules loaded for: $CLOUD_PROVIDER" >&2
    return 0
}

# ============================================================================
# CLOUD AUTHENTICATION WRAPPER
# ============================================================================

authenticate_cloud() {
    local provider="${CLOUD_PROVIDER:-$(detect_cloud_provider)}"

    log_info "Authenticating with cloud provider: $provider" >&2

    case "$provider" in
        aks)
            if command -v az_login >/dev/null 2>&1; then
                az_login
            else
                log_warning "AKS module not loaded or az_login not available" >&2
            fi
            ;;
        eks)
            if command -v aws_configure >/dev/null 2>&1; then
                aws_configure
            else
                log_warning "EKS module not loaded or aws_configure not available" >&2
            fi
            ;;
        gke)
            if [[ -n "${GCP_SERVICE_ACCOUNT_NAME}" && -n "${GCP_SERVICE_ACCOUNT_KEY_FILE}" ]]; then
                if command -v gcloud_auth >/dev/null 2>&1; then
                    gcloud_auth "${GCP_SERVICE_ACCOUNT_NAME}" "${GCP_SERVICE_ACCOUNT_KEY_FILE}"
                else
                    log_warning "GKE module not loaded or gcloud_auth not available" >&2
                fi
            else
                log_warning "GCP service account credentials not provided" >&2
            fi
            ;;
        *)
            log_info "No cloud authentication needed for $provider" >&2
            ;;
    esac
}

# ============================================================================
# CLOUD CLUSTER CREDENTIALS WRAPPER
# ============================================================================

get_cloud_cluster_credentials() {
    local provider="${CLOUD_PROVIDER:-$(detect_cloud_provider)}"

    log_info "Getting cluster credentials for: $provider" >&2

    case "$provider" in
        aks)
            if [[ -n "${AKS_CLUSTER_NAME}" && -n "${AKS_RESOURCE_GROUP}" ]]; then
                az_aks_get_credentials "${AKS_CLUSTER_NAME}" "${AKS_RESOURCE_GROUP}"
            else
                log_error "AKS cluster name and resource group required" >&2
                return 1
            fi
            ;;
        eks)
            # EKS typically uses KUBECONFIG provided by environment
            if [[ -n "${KUBECONFIG}" ]]; then
                log_info "Using existing KUBECONFIG for EKS" >&2
                aws_eks_verify_cluster
            else
                log_error "KUBECONFIG not set for EKS cluster" >&2
                return 1
            fi
            ;;
        gke)
            if [[ -n "${GKE_CLUSTER_NAME}" && -n "${GKE_CLUSTER_REGION}" && -n "${GCP_PROJECT}" ]]; then
                gcloud_gke_get_credentials "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GCP_PROJECT}"
            else
                log_error "GKE cluster name, region, and project required" >&2
                return 1
            fi
            ;;
        *)
            log_info "Using existing kubeconfig for $provider" >&2
            kubectl cluster-info >/dev/null 2>&1 || {
                log_error "Cannot connect to cluster" >&2
                return 1
            }
            ;;
    esac

    log_success "Cluster credentials configured successfully" >&2
    return 0
}

# ============================================================================
# CLOUD INGRESS WRAPPER
# ============================================================================

configure_cloud_ingress() {
    local namespace="${1:-rhdh}"
    local ingress_name="${2:-backstage}"
    local provider="${CLOUD_PROVIDER:-$(detect_cloud_provider)}"

    log_info "Configuring ingress for cloud provider: $provider" >&2

    case "$provider" in
        aks)
            if command -v configure_aks_ingress >/dev/null 2>&1; then
                configure_aks_ingress "$namespace" "$ingress_name"
            fi
            ;;
        eks)
            if command -v configure_eks_ingress_and_dns >/dev/null 2>&1; then
                configure_eks_ingress_and_dns "$namespace" "$ingress_name"
            fi
            ;;
        gke)
            if command -v configure_gke_ingress >/dev/null 2>&1; then
                configure_gke_ingress "$namespace" "$ingress_name"
            fi
            ;;
        *)
            log_info "Using generic ingress wait for $provider" >&2
            wait_for_ingress "$namespace" "$ingress_name"
            ;;
    esac
}

# ============================================================================
# CLOUD CLEANUP WRAPPER
# ============================================================================

cleanup_cloud_resources() {
    local provider="${CLOUD_PROVIDER:-$(detect_cloud_provider)}"

    log_info "Cleaning up cloud resources for: $provider" >&2

    case "$provider" in
        aks)
            if command -v cleanup_aks >/dev/null 2>&1; then
                cleanup_aks
            fi
            ;;
        eks)
            if [[ -n "${EKS_INSTANCE_DOMAIN_NAME}" ]]; then
                if command -v cleanup_eks_dns_record >/dev/null 2>&1; then
                    cleanup_eks_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
                fi
            fi
            ;;
        gke)
            if command -v cleanup_gke >/dev/null 2>&1; then
                cleanup_gke
            fi
            ;;
        *)
            log_info "No cloud-specific cleanup needed for $provider" >&2
            ;;
    esac

    log_success "Cloud cleanup completed" >&2
    return 0
}

# Export functions
export -f detect_cloud_provider load_cloud_module authenticate_cloud
export -f get_cloud_cluster_credentials configure_cloud_ingress cleanup_cloud_resources