#!/usr/bin/env bash
#
# EKS Helm Job - Deploy RHDH to Amazon Elastic Kubernetes Service using Helm
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load cloud modules for EKS
load_cloud_module "eks"

# ============================================================================
# JOB CONFIGURATION
# ============================================================================

# Namespaces for deployments
readonly EKS_NAMESPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
readonly EKS_NAMESPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"

# Release names
readonly EKS_RELEASE_NAME="${RELEASE_NAME:-rhdh}"
readonly EKS_RELEASE_NAME_RBAC="${RELEASE_NAME_RBAC:-rhdh-rbac}"

# Value files
readonly EKS_VALUE_FILE="${HELM_CHART_VALUE_FILE_NAME:-values_showcase.yaml}"
readonly EKS_RBAC_VALUE_FILE="${HELM_CHART_RBAC_VALUE_FILE_NAME:-values_showcase-rbac.yaml}"
readonly EKS_DIFF_VALUE_FILE="${HELM_CHART_EKS_DIFF_VALUE_FILE_NAME:-values_eks_diff.yaml}"
readonly EKS_RBAC_DIFF_VALUE_FILE="${HELM_CHART_RBAC_EKS_DIFF_VALUE_FILE_NAME:-values_rbac_eks_diff.yaml}"

# ============================================================================
# EKS DEPLOYMENT FUNCTIONS
# ============================================================================

setup_eks_cluster() {
    log_section "Setting up EKS cluster"

    # Configure AWS CLI if credentials are provided
    authenticate_cloud

    # Verify cluster connectivity (KUBECONFIG should be pre-configured)
    aws_eks_verify_cluster

    # Get cluster information
    aws_eks_get_cluster_info

    # Setup cluster API server URL
    local api_server_url
    api_server_url=$(get_cluster_api_server_url)
    export K8S_CLUSTER_API_SERVER_URL="$api_server_url"

    log_success "EKS cluster setup completed"
}

deploy_eks_helm() {
    local namespace="$1"
    local release_name="$2"
    local value_file="$3"
    local diff_value_file="${4:-}"

    log_section "Deploying RHDH to EKS with Helm"
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
        local spot_patch="${DIR}/cluster/eks/patch/eks-spot-patch.yaml"
        if [[ -f "$spot_patch" ]]; then
            patch_and_restart "$namespace" "deployment" "redis" "$spot_patch"
        fi
    fi

    # Uninstall existing release if present
    uninstall_helmchart "$namespace" "$release_name"

    # Apply pre-deployment YAML files
    apply_yaml_files "$namespace"

    # Prepare value files
    local final_value_file="/tmp/eks-${release_name}-values.yaml"

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

    # Handle extraAppConfig if specified
    if [[ -n "${EXTRA_APP_CONFIG_FILE:-}" && -f "${EXTRA_APP_CONFIG_FILE}" ]]; then
        export HELM_SET_FILES="upstream.backstage.extraAppConfig[0].content=${EXTRA_APP_CONFIG_FILE}"
    fi

    # Save value file to artifacts
    save_to_artifacts "$namespace" "$(basename "${final_value_file}")" "${final_value_file}"

    # Setup image pull secret if provided
    if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
        setup_image_pull_secret "$namespace" "rh-pull-secret" \
            "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
    fi

    # Deploy with Helm (initial deployment with temporary ingress)
    log_info "Deploying RHDH from: ${QUAY_REPO} with tag: ${TAG_NAME}"

    # For EKS, we need to deploy first, then get the load balancer hostname
    local temp_hostname="temporary.example.com"
    helm_install_rhdh \
        "$release_name" \
        "$namespace" \
        "$final_value_file" \
        "$temp_hostname"

    # Configure EKS ingress and get actual hostname
    configure_eks_ingress_and_dns "$namespace" "backstage"

    # Get the actual hostname
    local actual_hostname
    if [[ -n "${EKS_INSTANCE_DOMAIN_NAME:-}" ]]; then
        actual_hostname="https://${EKS_INSTANCE_DOMAIN_NAME}"
    elif [[ -n "${EKS_INGRESS_HOSTNAME:-}" ]]; then
        actual_hostname="https://${EKS_INGRESS_HOSTNAME}"
    else
        # Fallback to load balancer hostname
        actual_hostname="https://$(aws_eks_get_load_balancer_hostname "$namespace" "backstage")"
    fi

    export K8S_CLUSTER_ROUTER_BASE="${actual_hostname#https://}"

    # Update deployment with correct hostname if needed
    if [[ "$actual_hostname" != "https://$temp_hostname" ]]; then
        log_info "Updating deployment with actual hostname: $actual_hostname"
        helm upgrade "$release_name" "${HELM_CHART_URL}" \
            --version "${CHART_VERSION}" \
            --namespace "$namespace" \
            --values "$final_value_file" \
            --set-string "global.host=${K8S_CLUSTER_ROUTER_BASE}" \
            --set-string "upstream.backstage.image.repository=${QUAY_REPO}" \
            --set-string "upstream.backstage.image.tag=${TAG_NAME}" \
            --reuse-values \
            --wait
    fi

    # Get certificate if domain is configured
    if [[ -n "${EKS_INSTANCE_DOMAIN_NAME:-}" ]]; then
        get_eks_certificate "${EKS_INSTANCE_DOMAIN_NAME}"
    fi

    # Wait for deployment and test
    check_and_test "$release_name" "$namespace" "$actual_hostname"
}

cleanup_eks_deployment() {
    local namespace="$1"

    log_section "Cleaning up EKS deployment"

    # Cleanup DNS records if configured
    if [[ -n "${EKS_INSTANCE_DOMAIN_NAME:-}" ]]; then
        cleanup_eks_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
    fi

    # Delete namespace
    delete_namespace "$namespace"

    log_success "Cleanup completed for namespace: $namespace"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_header "EKS Helm Deployment Job"

    # Setup EKS cluster
    setup_eks_cluster

    # Deploy standard RHDH
    log_section "Standard RHDH Deployment"
    deploy_eks_helm \
        "$EKS_NAMESPACE" \
        "$EKS_RELEASE_NAME" \
        "$EKS_VALUE_FILE" \
        "$EKS_DIFF_VALUE_FILE"

    # Cleanup standard deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_eks_deployment "$EKS_NAMESPACE"
    fi

    # Deploy RBAC-enabled RHDH
    log_section "RBAC-enabled RHDH Deployment"
    deploy_eks_helm \
        "$EKS_NAMESPACE_RBAC" \
        "$EKS_RELEASE_NAME_RBAC" \
        "$EKS_RBAC_VALUE_FILE" \
        "$EKS_RBAC_DIFF_VALUE_FILE"

    # Cleanup RBAC deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_eks_deployment "$EKS_NAMESPACE_RBAC"
    fi

    log_success "EKS Helm deployment job completed successfully"
}

# Execute main function
main "$@"