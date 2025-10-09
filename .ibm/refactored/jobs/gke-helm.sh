#!/usr/bin/env bash
#
# GKE Helm Job - Deploy RHDH to Google Kubernetes Engine using Helm
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load cloud modules for GKE
load_cloud_module "gke"

# ============================================================================
# JOB CONFIGURATION
# ============================================================================

# Namespaces for deployments
readonly GKE_NAMESPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
readonly GKE_NAMESPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"

# Release names
readonly GKE_RELEASE_NAME="${RELEASE_NAME:-rhdh}"
readonly GKE_RELEASE_NAME_RBAC="${RELEASE_NAME_RBAC:-rhdh-rbac}"

# Value files
readonly GKE_VALUE_FILE="${HELM_CHART_VALUE_FILE_NAME:-values_showcase.yaml}"
readonly GKE_RBAC_VALUE_FILE="${HELM_CHART_RBAC_VALUE_FILE_NAME:-values_showcase-rbac.yaml}"
readonly GKE_DIFF_VALUE_FILE="${HELM_CHART_GKE_DIFF_VALUE_FILE_NAME:-values_gke_diff.yaml}"
readonly GKE_RBAC_DIFF_VALUE_FILE="${HELM_CHART_RBAC_GKE_DIFF_VALUE_FILE_NAME:-values_rbac_gke_diff.yaml}"

# ============================================================================
# GKE DEPLOYMENT FUNCTIONS
# ============================================================================

setup_gke_cluster() {
    log_section "Setting up GKE cluster"

    # Authenticate with GCP
    if [[ -n "${GCP_SERVICE_ACCOUNT_NAME:-}" && -n "${GCP_SERVICE_ACCOUNT_KEY_FILE:-}" ]]; then
        authenticate_cloud
    fi

    # Get cluster credentials
    if [[ -n "${GKE_CLUSTER_NAME:-}" && -n "${GKE_CLUSTER_REGION:-}" && -n "${GCP_PROJECT:-}" ]]; then
        get_cloud_cluster_credentials
    fi

    # Get cluster information
    gke_get_cluster_info

    # Setup cluster API server URL
    local api_server_url
    api_server_url=$(get_cluster_api_server_url)
    export K8S_CLUSTER_API_SERVER_URL="$api_server_url"

    log_success "GKE cluster setup completed"
}

deploy_gke_helm() {
    local namespace="$1"
    local release_name="$2"
    local value_file="$3"
    local diff_value_file="${4:-}"

    log_section "Deploying RHDH to GKE with Helm"
    log_info "Namespace: $namespace"
    log_info "Release: $release_name"

    # Create namespace
    create_namespace_if_not_exists "$namespace"

    # Setup service account and get token
    re_create_k8s_service_account_and_get_token "$namespace"

    # Setup Workload Identity if configured
    if [[ "${ENABLE_WORKLOAD_IDENTITY:-false}" == "true" ]]; then
        gke_create_workload_identity \
            "$namespace" \
            "backstage" \
            "backstage-gke" \
            "${GCP_PROJECT}"
    fi

    # Deploy Redis cache if needed
    if [[ "${DEPLOY_REDIS:-true}" == "true" ]]; then
        deploy_redis_cache "$namespace"

        # Patch Redis for preemptible nodes if patch file exists
        local preemptible_patch="${DIR}/cluster/gke/patch/gke-preemptible-patch.yaml"
        if [[ -f "$preemptible_patch" ]]; then
            patch_and_restart "$namespace" "deployment" "redis" "$preemptible_patch"
        fi
    fi

    # Uninstall existing release if present
    uninstall_helmchart "$namespace" "$release_name"

    # Apply pre-deployment YAML files
    apply_yaml_files "$namespace"

    # Prepare value files
    local final_value_file="/tmp/gke-${release_name}-values.yaml"

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

    # Create SSL certificate if domain is configured
    if [[ -n "${GKE_DOMAIN_NAME:-}" && -n "${GCP_PROJECT:-}" ]]; then
        local cert_name="${release_name}-cert-${RANDOM}"
        gcloud_ssl_cert_create "$cert_name" "${GKE_DOMAIN_NAME}" "${GCP_PROJECT}"
        export GKE_SSL_CERT_NAME="$cert_name"
    fi

    # Deploy with Helm (initial deployment)
    log_info "Deploying RHDH from: ${QUAY_REPO} with tag: ${TAG_NAME}"

    # For GKE, we need to deploy first, then get the ingress IP
    local temp_hostname="temporary.example.com"
    helm_install_rhdh \
        "$release_name" \
        "$namespace" \
        "$final_value_file" \
        "$temp_hostname"

    # Configure GKE ingress and get actual address
    configure_gke_ingress "$namespace" "backstage"

    # Get the actual hostname
    local actual_hostname
    if [[ -n "${GKE_DOMAIN_NAME:-}" ]]; then
        actual_hostname="https://${GKE_DOMAIN_NAME}"
    elif [[ -n "${GKE_INGRESS_ADDRESS:-}" ]]; then
        # Check if it's an IP or hostname
        if [[ "${GKE_INGRESS_ADDRESS}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            actual_hostname="http://${GKE_INGRESS_ADDRESS}"
        else
            actual_hostname="https://${GKE_INGRESS_ADDRESS}"
        fi
    else
        log_error "Failed to determine GKE ingress address"
        return 1
    fi

    export K8S_CLUSTER_ROUTER_BASE="${actual_hostname#https://}"
    export K8S_CLUSTER_ROUTER_BASE="${K8S_CLUSTER_ROUTER_BASE#http://}"

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

    # Wait for deployment and test
    check_and_test "$release_name" "$namespace" "$actual_hostname"
}

cleanup_gke_deployment() {
    local namespace="$1"

    log_section "Cleaning up GKE deployment"

    # Cleanup GKE-specific resources
    cleanup_gke

    # Delete namespace
    delete_namespace "$namespace"

    log_success "Cleanup completed for namespace: $namespace"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_header "GKE Helm Deployment Job"

    # Setup GKE cluster
    setup_gke_cluster

    # Deploy standard RHDH
    log_section "Standard RHDH Deployment"
    deploy_gke_helm \
        "$GKE_NAMESPACE" \
        "$GKE_RELEASE_NAME" \
        "$GKE_VALUE_FILE" \
        "$GKE_DIFF_VALUE_FILE"

    # Cleanup standard deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_gke_deployment "$GKE_NAMESPACE"
    fi

    # Deploy RBAC-enabled RHDH
    log_section "RBAC-enabled RHDH Deployment"
    deploy_gke_helm \
        "$GKE_NAMESPACE_RBAC" \
        "$GKE_RELEASE_NAME_RBAC" \
        "$GKE_RBAC_VALUE_FILE" \
        "$GKE_RBAC_DIFF_VALUE_FILE"

    # Cleanup RBAC deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_gke_deployment "$GKE_NAMESPACE_RBAC"
    fi

    log_success "GKE Helm deployment job completed successfully"
}

# Execute main function
main "$@"