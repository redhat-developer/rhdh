#!/usr/bin/env bash
#
# Platform Detection Module
#

# Guard to prevent multiple sourcing
if [[ -n "${_DETECTION_LOADED:-}" ]]; then
    return 0
fi
readonly _DETECTION_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"

detect_ocp() {
    if command -v oc &> /dev/null; then
        local ocp_version
        ocp_version=$(oc version 2>/dev/null | grep "Server Version" | awk '{print $3}' || echo "unknown")
        export IS_OPENSHIFT="true"
        export OCP_VERSION="${ocp_version}"
        log_info "OpenShift detected: ${ocp_version}"
        
        # Detect OSD-GCP if CLUSTER_TYPE or PLATFORM is set
        if [[ "${CLUSTER_TYPE:-}" == "osd-gcp" ]] || [[ "${PLATFORM:-}" == "gcp" ]]; then
            export CONTAINER_PLATFORM="osd-gcp"
            log_info "Detected OpenShift Dedicated on GCP"
        fi
    else
        export IS_OPENSHIFT="false"
        log_debug "OpenShift not detected"
    fi
}

detect_container_platform() {
    if command -v podman &> /dev/null; then
        export CONTAINER_PLATFORM="podman"
        export CONTAINER_PLATFORM_VERSION=$(podman --version | awk '{print $3}')
    elif command -v docker &> /dev/null; then
        export CONTAINER_PLATFORM="docker"
        export CONTAINER_PLATFORM_VERSION=$(docker --version | awk '{print $3}' | tr -d ',')
    else
        export CONTAINER_PLATFORM="none"
        log_warning "No container platform detected"
    fi
}

detect_platform() {
    # Detect operating system
    case "$(uname -s)" in
        Linux*)     export OS_PLATFORM="linux" ;;
        Darwin*)    export OS_PLATFORM="macos" ;;
        CYGWIN*|MINGW*|MSYS*) export OS_PLATFORM="windows" ;;
        *)          export OS_PLATFORM="unknown" ;;
    esac

    # Detect OpenShift first if not already detected
    if [[ -z "${IS_OPENSHIFT:-}" ]]; then
        detect_ocp
    fi

    # Detect container platform if not already detected
    if [[ -z "${CONTAINER_PLATFORM:-}" ]]; then
        detect_container_platform
    fi

    # Detect Kubernetes distribution
    if [[ "${IS_OPENSHIFT}" == "true" ]]; then
        export K8S_PLATFORM="openshift"
    elif command -v kubectl &> /dev/null; then
        # Try to detect specific K8s distributions using multiple methods
        local platform_detected="false"
        
        # Method 1: Check node labels (most reliable)
        if kubectl get nodes -o json 2>/dev/null | jq -r '.items[0].metadata.labels' | grep -q "node.kubernetes.io/instance-type.*aks"; then
            export K8S_PLATFORM="aks"
            platform_detected="true"
        elif kubectl get nodes -o json 2>/dev/null | jq -r '.items[0].spec.providerID' | grep -q "^aws://"; then
            export K8S_PLATFORM="eks"
            platform_detected="true"
        elif kubectl get nodes -o json 2>/dev/null | jq -r '.items[0].spec.providerID' | grep -q "^gce://"; then
            export K8S_PLATFORM="gke"
            platform_detected="true"
        fi
        
        # Method 2: Fallback to node output (less reliable)
        if [[ "${platform_detected}" == "false" ]]; then
            if kubectl get nodes -o wide 2>/dev/null | grep -qi "aks"; then
                export K8S_PLATFORM="aks"
            elif kubectl get nodes -o wide 2>/dev/null | grep -qi "eks"; then
                export K8S_PLATFORM="eks"
            elif kubectl get nodes -o wide 2>/dev/null | grep -qi "gke"; then
                export K8S_PLATFORM="gke"
            else
                export K8S_PLATFORM="kubernetes"
            fi
        fi
    else
        export K8S_PLATFORM="none"
    fi

    log_info "Platform: OS=${OS_PLATFORM}, K8s=${K8S_PLATFORM}, Container=${CONTAINER_PLATFORM}"
}

get_cluster_router_base() {
    local router_base=""

    # Ensure platform is detected if not already set
    if [[ -z "${K8S_PLATFORM:-}" ]]; then
        detect_platform
    fi

    if [[ "${K8S_PLATFORM:-}" == "openshift" ]] || [[ "${IS_OPENSHIFT:-}" == "true" ]]; then
        router_base=$(oc get route console -n openshift-console \
            -o=jsonpath='{.spec.host}' 2>/dev/null | sed 's/^[^.]*\.//' || echo "")

        # Fallback to alternative method if empty
        if [[ -z "${router_base}" ]]; then
            router_base=$(kubectl get ingresses -n openshift-console \
                -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null | sed 's/^[^.]*\.//' || echo "")
        fi

        # Last resort fallback
        if [[ -z "${router_base}" ]]; then
            router_base="apps.example.com"
        fi
    elif [[ "${K8S_PLATFORM:-}" == "aks" ]]; then
        # AKS: Try multiple methods
        # Method 1: Check for nginx ingress controller
        router_base=$(kubectl get svc -n app-routing-system -l app.kubernetes.io/name=nginx \
            -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        
        # Method 2: Check for any LoadBalancer service
        if [[ -z "${router_base}" ]]; then
            router_base=$(kubectl get svc -A -o json 2>/dev/null | \
                jq -r '.items[] | select(.spec.type=="LoadBalancer") | .status.loadBalancer.ingress[0].ip' | head -1 || echo "")
        fi
        
        # Method 3: Use cluster FQDN if available
        if [[ -z "${router_base}" ]] && [[ -n "${AKS_CLUSTER_FQDN:-}" ]]; then
            router_base="${AKS_CLUSTER_FQDN}"
        fi
    elif [[ "${K8S_PLATFORM:-}" == "eks" ]]; then
        # EKS: Get from ALB/NLB ingress or cluster endpoint
        router_base=$(kubectl get ingress -A -o json 2>/dev/null | \
            jq -r '.items[0].status.loadBalancer.ingress[0].hostname' 2>/dev/null || echo "")
        
        # Fallback to cluster endpoint domain
        if [[ -z "${router_base}" ]]; then
            router_base=$(kubectl config view --minify -o json 2>/dev/null | \
                jq -r '.clusters[0].cluster.server' | sed 's|https://||' | sed 's|:.*||' || echo "")
        fi
        
        # Use custom domain if set
        if [[ -z "${router_base}" ]] && [[ -n "${AWS_EKS_PARENT_DOMAIN:-}" ]]; then
            router_base="${AWS_EKS_PARENT_DOMAIN}"
        fi
    elif [[ "${K8S_PLATFORM:-}" == "gke" ]]; then
        # GKE: Check for external IP from ingress or load balancer
        router_base=$(kubectl get ingress -A -o json 2>/dev/null | \
            jq -r '.items[0].status.loadBalancer.ingress[0].ip' 2>/dev/null || echo "")
        
        # Fallback to any LoadBalancer service
        if [[ -z "${router_base}" ]]; then
            router_base=$(kubectl get svc -A -o json 2>/dev/null | \
                jq -r '.items[] | select(.spec.type=="LoadBalancer") | .status.loadBalancer.ingress[0].ip' | head -1 || echo "")
        fi
        
        # Use custom domain if set
        if [[ -z "${router_base}" ]] && [[ -n "${GKE_INSTANCE_DOMAIN_NAME:-}" ]]; then
            router_base="${GKE_INSTANCE_DOMAIN_NAME}"
        fi
    else
        # Try to detect from current context
        router_base=$(kubectl config view --minify \
            -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null | \
            sed 's|https://api\.|apps.|' | sed 's|:.*||' || echo "apps.example.com")
    fi

    echo "${router_base}"
}

##
# Calculate the expected Route hostname based on release name, namespace, and cluster router base
#
# This function predicts what the Route hostname will be after Helm deployment,
# allowing us to configure CORS correctly BEFORE the deployment happens.
#
# @param $1 release_name - The Helm release name
# @param $2 namespace - The Kubernetes namespace
# @param $3 fullname_override - The fullnameOverride value (optional, defaults to release_name)
# @return The expected full hostname (without protocol)
#
calculate_expected_route_hostname() {
    local release_name="${1}"
    local namespace="${2}"
    local fullname_override="${3:-${release_name}}"
    local router_base=""

    # Get cluster router base if not already set
    if [[ -z "${K8S_CLUSTER_ROUTER_BASE:-}" ]]; then
        router_base=$(get_cluster_router_base)
    else
        router_base="${K8S_CLUSTER_ROUTER_BASE}"
    fi

    # The janus-idp Helm chart creates Routes with the pattern:
    # <fullnameOverride>-<namespace>.<clusterRouterBase>
    # OR if fullnameOverride is not set:
    # <release-name>-backstage-<namespace>.<clusterRouterBase>
    
    local expected_hostname=""
    
    if [[ -n "${fullname_override}" ]] && [[ "${fullname_override}" != "${release_name}" ]]; then
        # When fullnameOverride is set, the Route name is: fullnameOverride-backstage
        expected_hostname="${fullname_override}-${namespace}.${router_base}"
    else
        # Default pattern: release-name-backstage
        expected_hostname="${release_name}-backstage-${namespace}.${router_base}"
    fi

    log_debug "Calculated expected Route hostname: ${expected_hostname}"
    echo "${expected_hostname}"
}

# ============================================================================
# BASE URL CALCULATION AND EXPORT
# ============================================================================

# Calculate expected hostname and export BASE_URL variables for use in secrets/configmaps
# This function combines hostname calculation with base64 encoding for envsubst
calculate_and_export_base_url() {
    local namespace="${1}"
    
    # Calculate expected Route hostname pattern: <fullnameOverride>-<namespace>.<clusterRouterBase>
    local expected_hostname="${DEPLOYMENT_FULLNAME_OVERRIDE}-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
    local rhdh_base_url="https://${expected_hostname}"
    
    log_info "Expected Route hostname: ${expected_hostname}" >&2
    log_info "Base URL for CORS: ${rhdh_base_url}" >&2

    # Export in base64 for use in Secrets/ConfigMaps via envsubst
    export RHDH_BASE_URL=$(echo -n "${rhdh_base_url}" | base64 | tr -d '\n')
    export RHDH_BASE_URL_HTTP=$(echo -n "${rhdh_base_url/https/http}" | base64 | tr -d '\n')

    log_debug "RHDH_BASE_URL exported for envsubst substitution" >&2
    
    # Return hostname for use in helm command
    echo "${expected_hostname}"
}

# Export functions
export -f detect_ocp detect_container_platform detect_platform get_cluster_router_base calculate_expected_route_hostname
export -f calculate_and_export_base_url