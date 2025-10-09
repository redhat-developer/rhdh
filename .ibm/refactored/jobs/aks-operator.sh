#!/usr/bin/env bash
#
# AKS Operator Job - Deploy RHDH to Azure Kubernetes Service using Operator
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load cloud modules for AKS
load_cloud_module "aks"

# Load operator module
source "${DIR}/modules/operator.sh"

# ============================================================================
# JOB CONFIGURATION
# ============================================================================

# Namespaces for deployments
readonly AKS_NAMESPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
readonly AKS_NAMESPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"

# Release names
readonly AKS_RELEASE_NAME="${RELEASE_NAME:-rhdh}"
readonly AKS_RELEASE_NAME_RBAC="${RELEASE_NAME_RBAC:-rhdh-rbac}"

# Value files
readonly AKS_VALUE_FILE="${HELM_CHART_VALUE_FILE_NAME:-values_showcase.yaml}"
readonly AKS_RBAC_VALUE_FILE="${HELM_CHART_RBAC_VALUE_FILE_NAME:-values_showcase-rbac.yaml}"
readonly AKS_DIFF_VALUE_FILE="${HELM_CHART_AKS_DIFF_VALUE_FILE_NAME:-values_aks_diff.yaml}"
readonly AKS_RBAC_DIFF_VALUE_FILE="${HELM_CHART_RBAC_AKS_DIFF_VALUE_FILE_NAME:-values_rbac_aks_diff.yaml}"

# ============================================================================
# AKS OPERATOR DEPLOYMENT FUNCTIONS
# ============================================================================

setup_aks_cluster() {
    log_section "Setting up AKS cluster for Operator deployment"

    # Authenticate with Azure if needed
    if [[ -n "${ARM_CLIENT_ID:-}" ]]; then
        authenticate_cloud
    fi

    # Get cluster credentials
    if [[ -n "${AKS_CLUSTER_NAME:-}" && -n "${AKS_RESOURCE_GROUP:-}" ]]; then
        get_cloud_cluster_credentials
    fi

    # Enable app routing if needed
    if [[ "${ENABLE_AKS_APP_ROUTING:-true}" == "true" ]]; then
        az_aks_approuting_enable "${AKS_CLUSTER_NAME}" "${AKS_RESOURCE_GROUP}"
    fi

    # Get the ingress controller IP
    local ingress_ip
    ingress_ip=$(kubectl get svc nginx --namespace app-routing-system \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

    if [[ -z "$ingress_ip" ]]; then
        log_error "Failed to get AKS ingress controller IP"
        return 1
    fi

    export K8S_CLUSTER_ROUTER_BASE="$ingress_ip"
    log_success "AKS cluster router base: $K8S_CLUSTER_ROUTER_BASE"
}

deploy_aks_operator() {
    local namespace="$1"
    local release_name="$2"
    local value_file="$3"
    local diff_value_file="${4:-}"
    local is_rbac="${5:-false}"

    log_section "Deploying RHDH to AKS with Operator"
    log_info "Namespace: $namespace"
    log_info "Release: $release_name"
    log_info "RBAC: $is_rbac"

    # Create namespace
    create_namespace_if_not_exists "$namespace"

    # Setup service account and get token
    re_create_k8s_service_account_and_get_token "$namespace"

    # Deploy Redis cache for non-RBAC deployments
    if [[ "$is_rbac" == "false" ]]; then
        deploy_redis_cache "$namespace"

        # Patch Redis for spot instances if patch file exists
        local spot_patch="${DIR}/cluster/aks/patch/aks-spot-patch.yaml"
        if [[ -f "$spot_patch" ]]; then
            patch_and_restart "$namespace" "deployment" "redis" "$spot_patch"
        fi
    fi

    # Apply pre-deployment YAML files
    local rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
    apply_yaml_files "$namespace"

    # Handle RBAC-specific configuration
    if [[ "$is_rbac" == "true" ]]; then
        # Create conditional policies for RBAC
        create_conditional_policies_operator "/tmp/conditional-policies.yaml"

        # Prepare operator app config for RBAC
        local app_config="${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
        if [[ -f "$app_config" ]]; then
            prepare_operator_app_config "$app_config"
        fi
    fi

    # Merge value files and create dynamic plugins ConfigMap
    local final_value_file="/tmp/aks-operator-${release_name}-values.yaml"

    if [[ -n "$diff_value_file" && -f "${DIR}/value_files/${diff_value_file}" ]]; then
        yq_merge_value_files "merge" \
            "${DIR}/value_files/${value_file}" \
            "${DIR}/value_files/${diff_value_file}" \
            "${final_value_file}"
    else
        cp "${DIR}/value_files/${value_file}" "${final_value_file}"
    fi

    # Create dynamic plugins ConfigMap
    local configmap_file="/tmp/configmap-dynamic-plugins-${release_name}.yaml"
    create_dynamic_plugins_config "${final_value_file}" "${configmap_file}"

    # Save ConfigMap to artifacts
    save_to_artifacts "$namespace" "$(basename "${configmap_file}")" "${configmap_file}"

    # Apply the ConfigMap
    kubectl apply -f "${configmap_file}" -n "${namespace}"

    # Setup image pull secret if provided
    if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
        setup_image_pull_secret "$namespace" "rh-pull-secret" \
            "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
    fi

    # Deploy RHDH operator
    local operator_yaml
    if [[ "$is_rbac" == "true" ]]; then
        operator_yaml="${DIR}/resources/rhdh-operator/rhdh-start-rbac_K8s.yaml"
    else
        operator_yaml="${DIR}/resources/rhdh-operator/rhdh-start_K8s.yaml"
    fi

    deploy_rhdh_operator "$namespace" "$operator_yaml"

    # Patch resources for spot instances
    patch_aks_spot_instances "$namespace" "$release_name" "$is_rbac"

    # Apply ingress for AKS
    apply_aks_operator_ingress "$namespace" "backstage-${release_name}"

    # Wait for deployment and test
    check_and_test "$release_name" "$namespace" "$rhdh_base_url"
}

patch_aks_spot_instances() {
    local namespace="$1"
    local release_name="$2"
    local is_rbac="$3"

    local spot_patch="${DIR}/cluster/aks/patch/aks-spot-patch.yaml"

    if [[ ! -f "$spot_patch" ]]; then
        log_warning "AKS spot patch file not found, skipping spot instance patching"
        return 0
    fi

    # Patch PostgreSQL StatefulSet
    if kubectl get statefulset "backstage-psql-${release_name}" -n "${namespace}" &>/dev/null; then
        patch_and_restart "$namespace" "statefulset" "backstage-psql-${release_name}" "$spot_patch"
    fi

    # Patch Backstage Deployment
    if kubectl get deployment "backstage-${release_name}" -n "${namespace}" &>/dev/null; then
        patch_and_restart "$namespace" "deployment" "backstage-${release_name}" "$spot_patch"
    fi
}

apply_aks_operator_ingress() {
    local namespace="$1"
    local service_name="$2"

    log_info "Applying AKS Operator ingress for service: $service_name"

    # Check if ingress manifest exists
    local ingress_manifest="${DIR}/cluster/aks/manifest/aks-operator-ingress.yaml"

    if [[ ! -f "$ingress_manifest" ]]; then
        log_warning "AKS operator ingress manifest not found, creating default ingress"

        cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backstage
  annotations:
    kubernetes.io/ingress.class: webapprouting.kubernetes.azure.com
spec:
  rules:
  - http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ${service_name}
            port:
              number: 7007
EOF
    else
        # Use existing manifest with service name replacement
        cat "$ingress_manifest" | \
            yq ".spec.rules[0].http.paths[0].backend.service.name = \"$service_name\"" - | \
            kubectl apply --namespace="${namespace}" -f -
    fi

    log_success "AKS Operator ingress applied successfully"
}

cleanup_aks_operator_deployment() {
    local namespace="$1"

    log_section "Cleaning up AKS Operator deployment"

    # Delete operator resources
    cleanup_operator "$namespace"

    # Delete namespace
    delete_namespace "$namespace"

    log_success "Cleanup completed for namespace: $namespace"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_header "AKS Operator Deployment Job"

    # Setup AKS cluster
    setup_aks_cluster

    # Setup operator
    cluster_setup_k8s_operator
    prepare_operator "3"

    # Deploy standard RHDH with Operator
    log_section "Standard RHDH Operator Deployment"
    deploy_aks_operator \
        "$AKS_NAMESPACE" \
        "$AKS_RELEASE_NAME" \
        "$AKS_VALUE_FILE" \
        "$AKS_DIFF_VALUE_FILE" \
        "false"

    # Cleanup standard deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_aks_operator_deployment "$AKS_NAMESPACE"
    fi

    # Deploy RBAC-enabled RHDH with Operator
    log_section "RBAC-enabled RHDH Operator Deployment"
    deploy_aks_operator \
        "$AKS_NAMESPACE_RBAC" \
        "$AKS_RELEASE_NAME_RBAC" \
        "$AKS_RBAC_VALUE_FILE" \
        "$AKS_RBAC_DIFF_VALUE_FILE" \
        "true"

    # Cleanup RBAC deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_aks_operator_deployment "$AKS_NAMESPACE_RBAC"
    fi

    log_success "AKS Operator deployment job completed successfully"
}

# Execute main function
main "$@"