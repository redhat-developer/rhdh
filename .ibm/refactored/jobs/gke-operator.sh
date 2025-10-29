#!/usr/bin/env bash
#
# GKE Operator Job - Deploy RHDH to Google Kubernetes Engine using Operator
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load cloud modules for GKE
load_cloud_module "gke"

# Load operator module
source "${DIR}/modules/operator.sh"

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
# GKE OPERATOR DEPLOYMENT FUNCTIONS
# ============================================================================

setup_gke_cluster() {
    log_section "Setting up GKE cluster for Operator deployment"

    # Authenticate with GCP if needed
    if [[ -n "${GCP_PROJECT:-}" ]]; then
        authenticate_cloud
    fi

    # Get cluster credentials
    if [[ -n "${GKE_CLUSTER_NAME:-}" && -n "${GKE_CLUSTER_REGION:-}" ]]; then
        get_cloud_cluster_credentials
    fi

    # Enable workload identity if needed
    if [[ "${ENABLE_GKE_WORKLOAD_IDENTITY:-false}" == "true" ]]; then
        enable_gke_workload_identity "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GCP_PROJECT}"
    fi

    # Get the ingress controller IP
    local ingress_ip
    ingress_ip=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

    if [[ -z "$ingress_ip" ]]; then
        # Try getting from GKE ingress
        ingress_ip=$(kubectl get ingress -A -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
    fi

    if [[ -z "$ingress_ip" ]]; then
        log_warning "Could not get GKE ingress IP, using cluster endpoint"
        ingress_ip="${K8S_CLUSTER_API_SERVER_URL#https://}"
        ingress_ip="${ingress_ip%%:*}"
    fi

    export K8S_CLUSTER_ROUTER_BASE="$ingress_ip"
    log_success "GKE cluster router base: $K8S_CLUSTER_ROUTER_BASE"
}

deploy_gke_operator() {
    local namespace="$1"
    local release_name="$2"
    local value_file="$3"
    local diff_value_file="${4:-}"
    local is_rbac="${5:-false}"

    log_section "Deploying RHDH to GKE with Operator"
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

        # Patch Redis for GKE preemptible nodes if patch file exists
        local gke_patch="${DIR}/cluster/gke/patch/gke-preemptible-patch.yaml"
        if [[ -f "$gke_patch" ]]; then
            patch_and_restart "$namespace" "deployment" "redis" "$gke_patch"
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
    local final_value_file="/tmp/gke-operator-${release_name}-values.yaml"

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

    # Patch resources for GKE preemptible nodes
    patch_gke_preemptible "$namespace" "$release_name" "$is_rbac"

    # Apply ingress for GKE
    apply_gke_operator_ingress "$namespace" "backstage-${release_name}"

    # Wait for deployment and test
    check_and_test "$release_name" "$namespace" "$rhdh_base_url"
}

patch_gke_preemptible() {
    local namespace="$1"
    local release_name="$2"
    local is_rbac="$3"

    local gke_patch="${DIR}/cluster/gke/patch/gke-preemptible-patch.yaml"

    if [[ ! -f "$gke_patch" ]]; then
        log_info "GKE preemptible patch file not found, skipping resource patching"
        return 0
    fi

    # Patch PostgreSQL StatefulSet
    if kubectl get statefulset "backstage-psql-${release_name}" -n "${namespace}" &>/dev/null; then
        patch_and_restart "$namespace" "statefulset" "backstage-psql-${release_name}" "$gke_patch"
    fi

    # Patch Backstage Deployment
    if kubectl get deployment "backstage-${release_name}" -n "${namespace}" &>/dev/null; then
        patch_and_restart "$namespace" "deployment" "backstage-${release_name}" "$gke_patch"
    fi
}

apply_gke_operator_ingress() {
    local namespace="$1"
    local service_name="$2"

    log_info "Applying GKE Operator ingress for service: $service_name"

    # Check if ingress manifest exists
    local ingress_manifest="${DIR}/cluster/gke/manifest/gke-operator-ingress.yaml"

    if [[ ! -f "$ingress_manifest" ]]; then
        log_warning "GKE operator ingress manifest not found, creating default ingress"

        cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backstage
  annotations:
    kubernetes.io/ingress.class: nginx
    kubernetes.io/ingress.global-static-ip-name: backstage-ip
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - backstage.${K8S_CLUSTER_ROUTER_BASE}.nip.io
    secretName: backstage-tls
  rules:
  - host: backstage.${K8S_CLUSTER_ROUTER_BASE}.nip.io
    http:
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
            yq ".spec.rules[0].host = \"backstage.${K8S_CLUSTER_ROUTER_BASE}.nip.io\"" - | \
            yq ".spec.tls[0].hosts[0] = \"backstage.${K8S_CLUSTER_ROUTER_BASE}.nip.io\"" - | \
            kubectl apply --namespace="${namespace}" -f -
    fi

    log_success "GKE Operator ingress applied successfully"
}

cleanup_gke_operator_deployment() {
    local namespace="$1"

    log_section "Cleaning up GKE Operator deployment"

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
    log_header "GKE Operator Deployment Job"

    # Setup GKE cluster
    setup_gke_cluster

    # Setup operator
    cluster_setup_k8s_operator
    prepare_operator "3"

    # Deploy standard RHDH with Operator
    log_section "Standard RHDH Operator Deployment"
    deploy_gke_operator \
        "$GKE_NAMESPACE" \
        "$GKE_RELEASE_NAME" \
        "$GKE_VALUE_FILE" \
        "$GKE_DIFF_VALUE_FILE" \
        "false"

    # Cleanup standard deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_gke_operator_deployment "$GKE_NAMESPACE"
    fi

    # Deploy RBAC-enabled RHDH with Operator
    log_section "RBAC-enabled RHDH Operator Deployment"
    deploy_gke_operator \
        "$GKE_NAMESPACE_RBAC" \
        "$GKE_RELEASE_NAME_RBAC" \
        "$GKE_RBAC_VALUE_FILE" \
        "$GKE_RBAC_DIFF_VALUE_FILE" \
        "true"

    # Cleanup RBAC deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_gke_operator_deployment "$GKE_NAMESPACE_RBAC"
    fi

    log_success "GKE Operator deployment job completed successfully"
}

# Execute main function
main "$@"