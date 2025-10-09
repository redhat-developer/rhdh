#!/usr/bin/env bash
#
# AKS Helm Job - Deploy RHDH to Azure Kubernetes Service using Helm
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load cloud modules for AKS
load_cloud_module "aks"

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
# AKS DEPLOYMENT FUNCTIONS
# ============================================================================

setup_aks_cluster() {
    log_section "Setting up AKS cluster"

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

deploy_aks_helm() {
    local namespace="$1"
    local release_name="$2"
    local value_file="$3"
    local diff_value_file="${4:-}"

    log_section "Deploying RHDH to AKS with Helm"
    log_info "Namespace: $namespace"
    log_info "Release: $release_name"

    # Create namespace
    create_namespace_if_not_exists "$namespace"

    # Setup service account and get token
    re_create_k8s_service_account_and_get_token "$namespace"

    # Deploy Redis cache if needed
    if [[ "${DEPLOY_REDIS:-true}" == "true" ]]; then
        deploy_redis_cache "$namespace"

        # Patch Redis for spot instances if patch file exists
        local spot_patch="${DIR}/cluster/aks/patch/aks-spot-patch.yaml"
        if [[ -f "$spot_patch" ]]; then
            patch_and_restart "$namespace" "deployment" "redis" "$spot_patch"
        fi
    fi

    # Uninstall existing release if present
    uninstall_helmchart "$namespace" "$release_name"

    # Apply pre-deployment YAML files
    apply_yaml_files "$namespace"

    # Prepare value files
    local final_value_file="/tmp/aks-${release_name}-values.yaml"

    if [[ -n "$diff_value_file" && -f "${DIR}/value_files/${diff_value_file}" ]]; then
        # Merge base and diff value files
        yq_merge_value_files "merge" \
            "${DIR}/value_files/${value_file}" \
            "${DIR}/value_files/${diff_value_file}" \
            "${final_value_file}"
    else
        # Use base value file as-is
        cp "${DIR}/value_files/${value_file}" "${final_value_file}"
    fi

    # Save value file to artifacts
    save_to_artifacts "$namespace" "$(basename "${final_value_file}")" "${final_value_file}"

    # Setup image pull secret if provided
    if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
        setup_image_pull_secret "$namespace" "rh-pull-secret" \
            "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
    fi

    # Calculate hostname
    local expected_hostname="https://${K8S_CLUSTER_ROUTER_BASE}"

    # Deploy with Helm
    log_info "Deploying RHDH from: ${QUAY_REPO} with tag: ${TAG_NAME}"

    helm_install_rhdh \
        "$release_name" \
        "$namespace" \
        "$final_value_file" \
        "$expected_hostname"

    # Wait for deployment and test
    check_and_test "$release_name" "$namespace" "$expected_hostname"
}

cleanup_aks_deployment() {
    local namespace="$1"

    log_section "Cleaning up AKS deployment"

    delete_namespace "$namespace"

    log_success "Cleanup completed for namespace: $namespace"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_header "AKS Helm Deployment Job"

    # Setup AKS cluster
    setup_aks_cluster

    # Deploy standard RHDH
    log_section "Standard RHDH Deployment"
    deploy_aks_helm \
        "$AKS_NAMESPACE" \
        "$AKS_RELEASE_NAME" \
        "$AKS_VALUE_FILE" \
        "$AKS_DIFF_VALUE_FILE"

    # Cleanup standard deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_aks_deployment "$AKS_NAMESPACE"
    fi

    # Deploy RBAC-enabled RHDH
    log_section "RBAC-enabled RHDH Deployment"
    deploy_aks_helm \
        "$AKS_NAMESPACE_RBAC" \
        "$AKS_RELEASE_NAME_RBAC" \
        "$AKS_RBAC_VALUE_FILE" \
        "$AKS_RBAC_DIFF_VALUE_FILE"

    # Cleanup RBAC deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_aks_deployment "$AKS_NAMESPACE_RBAC"
    fi

    log_success "AKS Helm deployment job completed successfully"
}

# Execute main function
main "$@"