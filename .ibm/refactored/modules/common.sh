#!/usr/bin/env bash
#
# Common Utilities Module - Shared utility functions
#

# Guard to prevent multiple sourcing
if [[ -n "${_COMMON_LOADED:-}" ]]; then
    return 0
fi
readonly _COMMON_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/k8s-operations.sh"
source "$(dirname "${BASH_SOURCE[0]}")/platform/detection.sh"

# ============================================================================
# PREFLIGHT CHECKS
# ============================================================================

preflight_checks() {
    log_info "Running pre-flight checks"

    # Check for required tools
    local required_tools=("kubectl" "helm" "git" "jq" "curl" "base64")
    local optional_tools=("yq" "oc")
    local missing_tools=()
    local missing_optional=()

    for tool in "${required_tools[@]}"; do
        if ! command -v "${tool}" &> /dev/null; then
            missing_tools+=("${tool}")
        fi
    done

    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_info "Please install the missing tools and try again"
        log_info "Installation hints:"
        for tool in "${missing_tools[@]}"; do
            case "${tool}" in
                jq)
                    log_info "  jq: brew install jq (macOS) or apt-get install jq (Linux)"
                    ;;
                yq)
                    log_info "  yq: brew install yq (macOS) or download from https://github.com/mikefarah/yq"
                    ;;
                kubectl)
                    log_info "  kubectl: https://kubernetes.io/docs/tasks/tools/"
                    ;;
                helm)
                    log_info "  helm: https://helm.sh/docs/intro/install/"
                    ;;
            esac
        done
        exit 1
    fi

    # Check optional tools
    for tool in "${optional_tools[@]}"; do
        if ! command -v "${tool}" &> /dev/null; then
            missing_optional+=("${tool}")
        fi
    done

    if [[ ${#missing_optional[@]} -gt 0 ]]; then
        log_warning "Optional tools not found: ${missing_optional[*]}"
        log_info "Some features may be limited without these tools"
    fi

    # Detect platform
    detect_platform
    detect_container_platform

    # Check cluster connectivity
    if command -v kubectl &> /dev/null; then
        if ! kubectl cluster-info &> /dev/null; then
            log_warning "Cannot connect to Kubernetes cluster"
            log_info "Some jobs may require cluster access"
        else
            log_success "Kubernetes cluster is accessible"
        fi
    fi

    # Set default values if not provided
    export NAME_SPACE="${NAME_SPACE:-showcase}"
    export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
    export RELEASE_NAME="${RELEASE_NAME:-rhdh}"
    export RELEASE_NAME_RBAC="${RELEASE_NAME_RBAC:-rhdh-rbac}"

    log_success "Pre-flight checks completed"
}

# ============================================================================
# CLEANUP OPERATIONS
# ============================================================================

cleanup_namespaces() {
    log_info "Cleaning up all RHDH-related namespaces and operators"

    # Fast mode: aggressive parallel cleanup
    if [[ "${FAST_CLEANUP:-false}" == "true" ]]; then
        log_warning "FAST_CLEANUP enabled - using aggressive parallel deletion"
        cleanup_namespaces_fast
        log_success "Fast cleanup completed"
        return 0
    fi

    # Main application namespaces
    local namespaces=(
        "${NAME_SPACE}"
        "${NAME_SPACE_RBAC}"
        "${NAME_SPACE_RUNTIME}"
        "${NAME_SPACE_POSTGRES_DB}"
        "${NAME_SPACE_SANITY_PLUGINS_CHECK}"
        "showcase-ci-nightly"
        "showcase-rbac-nightly"
        "orchestrator-gitops"
        "orchestrator-infra"
        "postgres-operator"
        "rhdh-operator"
    )

    # First, try to remove Helm releases (faster if they exist)
    log_info "Removing Helm releases"
    for ns in "${namespaces[@]}"; do
        if [[ -n "${ns:-}" ]] && kubectl get namespace "${ns}" &>/dev/null; then
            # List and remove all helm releases in the namespace
            local releases=$(helm list -n "${ns}" -q 2>/dev/null || true)
            if [[ -n "${releases}" ]]; then
                for release in ${releases}; do
                    log_debug "Removing Helm release: ${release} from namespace ${ns}"
                    helm uninstall "${release}" -n "${ns}" --wait=false 2>/dev/null || true
                done
            fi
        fi
    done

    # Delete application namespaces with force cleanup for stuck resources
    for ns in "${namespaces[@]}"; do
        if [[ -n "${ns:-}" ]]; then
            if kubectl get namespace "${ns}" &>/dev/null; then
                local phase=$(kubectl get namespace "${ns}" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")

                if [[ "${phase}" == "Terminating" ]]; then
                    log_warning "Namespace ${ns} is stuck in Terminating state, attempting force cleanup"
                    force_cleanup_namespace "${ns}"
                else
                    delete_namespace "${ns}"
                fi
            fi
        fi
    done

    # Clean up operators from openshift-operators namespace
    log_info "Cleaning up operators from openshift-operators namespace"
    kubectl delete subscription openshift-pipelines-operator -n openshift-operators 2>/dev/null || true
    kubectl delete subscription advanced-cluster-management -n openshift-operators 2>/dev/null || true
    kubectl delete subscription serverless-operator -n openshift-operators 2>/dev/null || true
    kubectl delete subscription logic-operator-rhel8 -n openshift-operators 2>/dev/null || true
    kubectl delete csv -l operators.coreos.com/openshift-pipelines-operator.openshift-operators -n openshift-operators 2>/dev/null || true
    kubectl delete csv -l operators.coreos.com/advanced-cluster-management.openshift-operators -n openshift-operators 2>/dev/null || true
    kubectl delete csv -l operators.coreos.com/serverless-operator.openshift-operators -n openshift-operators 2>/dev/null || true
    kubectl delete csv -l operators.coreos.com/logic-operator-rhel8.openshift-operators -n openshift-operators 2>/dev/null || true

    log_success "Cleanup completed"
}

cleanup_namespaces_fast() {
    # Main application namespaces (reusing same list as safe mode)
    local namespaces=(
        "${NAME_SPACE}"
        "${NAME_SPACE_RBAC}"
        "${NAME_SPACE_RUNTIME}"
        "${NAME_SPACE_POSTGRES_DB}"
        "${NAME_SPACE_SANITY_PLUGINS_CHECK}"
        "showcase-ci-nightly"
        "showcase-rbac-nightly"
        "orchestrator-gitops"
        "orchestrator-infra"
        "postgres-operator"
        "rhdh-operator"
    )

    # Uninstall helm releases in parallel
    log_info "Uninstalling Helm releases (fast)"
    for ns in "${namespaces[@]}"; do
        if [[ -n "${ns:-}" ]] && kubectl get namespace "${ns}" &>/dev/null; then
            (
                local releases
                releases=$(helm list -n "${ns}" -q 2>/dev/null || true)
                for release in ${releases}; do
                    log_debug "[fast] Uninstall ${release} in ${ns}"
                    helm uninstall "${release}" -n "${ns}" --wait=false 2>/dev/null || true
                done
            ) &
        fi
    done
    wait || true

    # Delete namespaces aggressively without waiting
    log_info "Deleting namespaces aggressively"
    for ns in "${namespaces[@]}"; do
        [[ -z "${ns:-}" ]] && continue
        (
            if kubectl get namespace "${ns}" &>/dev/null; then
                kubectl delete namespace "${ns}" --grace-period=0 --force --wait=false 2>/dev/null || true
                # Remove finalizers quickly
                kubectl patch namespace "${ns}" -p '{"metadata":{"finalizers":[]}}' --type=merge 2>/dev/null || true
                # Also try finalize API (best-effort)
                kubectl get namespace "${ns}" -o json 2>/dev/null | \
                    jq '.spec.finalizers=[]' | \
                    kubectl replace --raw "/api/v1/namespaces/${ns}/finalize" -f - 2>/dev/null || true
            fi
        ) &
    done
    wait || true

    # Batch-remove common operator subscriptions (non-blocking)
    kubectl delete subscription \
        openshift-pipelines-operator \
        advanced-cluster-management \
        serverless-operator \
        logic-operator-rhel8 \
        -n openshift-operators \
        --grace-period=0 --force 2>/dev/null || true
}

force_cleanup_namespace() {
    local namespace="$1"

    log_warning "Force cleaning namespace ${namespace}"

    # Remove finalizers from all resources in the namespace
    log_debug "Removing finalizers from resources in namespace ${namespace}"

    # List of resource types that commonly have finalizers
    local resource_types=(
        "pods"
        "deployments"
        "services"
        "configmaps"
        "secrets"
        "persistentvolumeclaims"
        "sonataflows"
        "sonataflowplatforms"
        "postgresclusters"  # Add PostgresCluster to avoid stuck namespace
    )

    for resource_type in "${resource_types[@]}"; do
        local resources=$(kubectl get "${resource_type}" -n "${namespace}" -o name 2>/dev/null || true)
        for resource in ${resources}; do
            log_debug "Removing finalizers from ${resource}"
            kubectl patch "${resource}" -n "${namespace}" -p '{"metadata":{"finalizers":[]}}' --type=merge 2>/dev/null || true
        done
    done

    # Remove finalizers from the namespace itself
    kubectl patch namespace "${namespace}" -p '{"metadata":{"finalizers":[]}}' --type=merge 2>/dev/null || true

    # Force delete the namespace using API finalize endpoint (most aggressive)
    log_debug "Forcing namespace deletion via API"
    kubectl get namespace "${namespace}" -o json 2>/dev/null | \
        jq '.spec.finalizers=[]' | \
        kubectl replace --raw "/api/v1/namespaces/${namespace}/finalize" -f - 2>/dev/null || true

    # Fallback: Force delete the namespace
    kubectl delete namespace "${namespace}" --grace-period=0 --force 2>/dev/null || true
}

# ============================================================================
# RESOURCE VERIFICATION
# ============================================================================

check_cluster_resources() {
    log_info "Checking cluster resource availability"

    # Check node resources
    if command -v kubectl &> /dev/null; then
        local node_count
        node_count=$(kubectl get nodes --no-headers 2>/dev/null | wc -l)

        if [[ $node_count -eq 0 ]]; then
            log_warning "No nodes found or cluster not accessible"
            return 1
        fi

        log_info "Found ${node_count} nodes in cluster"

        # Check for pending pods that might indicate resource constraints
        local pending_pods
        pending_pods=$(kubectl get pods --all-namespaces --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l)

        if [[ $pending_pods -gt 0 ]]; then
            log_warning "Found ${pending_pods} pending pods - cluster may be resource constrained"
            log_info "Consider checking cluster resources for detailed analysis"
        else
            log_success "No pending pods found - cluster resources appear adequate"
        fi
    else
        log_warning "kubectl not available - skipping resource checks"
    fi
}

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

tag_image() {
    local source_image="$1"
    local target_image="$2"
    local container_tool="${CONTAINER_PLATFORM:-podman}"

    log_info "Tagging image: ${source_image} -> ${target_image}"

    # Pull source image
    ${container_tool} pull "${source_image}"

    # Tag image
    ${container_tool} tag "${source_image}" "${target_image}"

    # Push if registry credentials are available
    if [[ -n "${QUAY_TOKEN:-}" ]]; then
        ${container_tool} push "${target_image}"
        log_success "Image pushed: ${target_image}"
    else
        log_warning "No registry credentials, skipping push"
    fi
}

sed_inplace() {
    if [[ "$OS_PLATFORM" == "macos" ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

create_app_config_map() {
    local config_file="$1"
    local namespace="$2"

    log_info "Creating app config map from ${config_file}"

    if [[ ! -f "${config_file}" ]]; then
        log_error "Config file not found: ${config_file}"
        return 1
    fi

    # Apply the config map
    kubectl apply -f "${config_file}" -n "${namespace}"
    log_success "App config map created"
}

select_config_map_file() {
    local deployment_type="$1"

    case "${deployment_type}" in
        base)
            echo "${DIR}/resources/config_map/app-config-rhdh.yaml"
            ;;
        rbac)
            echo "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
            ;;
        *)
            echo "${DIR}/resources/config_map/app-config-rhdh.yaml"
            ;;
    esac
}

create_dynamic_plugins_config() {
    local namespace="$1"
    local release_name="${2:-rhdh}"

    log_info "Creating dynamic plugins config for ${release_name}"

    # This would contain the actual dynamic plugins configuration
    kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${release_name}-dynamic-plugins
  namespace: ${namespace}
data:
  dynamic-plugins.yaml: |
    includes:
      - ./dynamic-plugins/dist
    plugins: []
EOF
}

setup_image_pull_secret() {
    local namespace="$1"
    local secret_name="registry-pull-secret"

    if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
        kubectl create secret docker-registry "${secret_name}" \
            --docker-server=registry.redhat.io \
            --from-file=.dockerconfigjson="${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}" \
            -n "${namespace}" --dry-run=client -o yaml | kubectl apply -f -
    fi
}

# Export functions
export -f preflight_checks cleanup_namespaces force_cleanup_namespace check_cluster_resources
export -f tag_image sed_inplace create_app_config_map select_config_map_file
export -f create_dynamic_plugins_config setup_image_pull_secret