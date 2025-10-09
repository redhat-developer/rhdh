#!/usr/bin/env bash
#
# EKS Operator Job - Deploy RHDH to Amazon Elastic Kubernetes Service using Operator
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load cloud modules for EKS
load_cloud_module "eks"

# Load operator module
source "${DIR}/modules/operator.sh"

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
# EKS OPERATOR DEPLOYMENT FUNCTIONS
# ============================================================================

setup_eks_cluster() {
    log_section "Setting up EKS cluster for Operator deployment"

    # Authenticate with AWS if needed
    if [[ -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
        authenticate_cloud
    fi

    # Update kubeconfig for EKS cluster
    if [[ -n "${EKS_CLUSTER_NAME:-}" && -n "${AWS_REGION:-}" ]]; then
        get_cloud_cluster_credentials
    fi

    # Install AWS Load Balancer Controller if needed
    if [[ "${INSTALL_AWS_LB_CONTROLLER:-true}" == "true" ]]; then
        install_aws_lb_controller "${EKS_CLUSTER_NAME}" "${AWS_REGION}"
    fi

    # Get the ingress controller hostname
    local ingress_hostname
    ingress_hostname=$(kubectl get svc -n kube-system aws-load-balancer-webhook-service \
        -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")

    if [[ -z "$ingress_hostname" ]]; then
        # Try getting from ingress-nginx namespace as fallback
        ingress_hostname=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
            -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
    fi

    if [[ -z "$ingress_hostname" ]]; then
        log_warning "Could not get EKS ingress hostname, using cluster endpoint"
        ingress_hostname="${K8S_CLUSTER_API_SERVER_URL#https://}"
    fi

    export K8S_CLUSTER_ROUTER_BASE="${ingress_hostname}"
    log_success "EKS cluster router base: $K8S_CLUSTER_ROUTER_BASE"
}

deploy_eks_operator() {
    local namespace="$1"
    local release_name="$2"
    local value_file="$3"
    local diff_value_file="${4:-}"
    local is_rbac="${5:-false}"

    log_section "Deploying RHDH to EKS with Operator"
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

        # Patch Redis for EKS if patch file exists
        local eks_patch="${DIR}/cluster/eks/patch/eks-patch.yaml"
        if [[ -f "$eks_patch" ]]; then
            patch_and_restart "$namespace" "deployment" "redis" "$eks_patch"
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
    local final_value_file="/tmp/eks-operator-${release_name}-values.yaml"

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

    # Patch resources for EKS
    patch_eks_resources "$namespace" "$release_name" "$is_rbac"

    # Apply ingress for EKS
    apply_eks_operator_ingress "$namespace" "backstage-${release_name}"

    # Wait for deployment and test
    check_and_test "$release_name" "$namespace" "$rhdh_base_url"
}

patch_eks_resources() {
    local namespace="$1"
    local release_name="$2"
    local is_rbac="$3"

    local eks_patch="${DIR}/cluster/eks/patch/eks-patch.yaml"

    if [[ ! -f "$eks_patch" ]]; then
        log_info "EKS patch file not found, skipping resource patching"
        return 0
    fi

    # Patch PostgreSQL StatefulSet
    if kubectl get statefulset "backstage-psql-${release_name}" -n "${namespace}" &>/dev/null; then
        patch_and_restart "$namespace" "statefulset" "backstage-psql-${release_name}" "$eks_patch"
    fi

    # Patch Backstage Deployment
    if kubectl get deployment "backstage-${release_name}" -n "${namespace}" &>/dev/null; then
        patch_and_restart "$namespace" "deployment" "backstage-${release_name}" "$eks_patch"
    fi
}

apply_eks_operator_ingress() {
    local namespace="$1"
    local service_name="$2"

    log_info "Applying EKS Operator ingress for service: $service_name"

    # Check if ingress manifest exists
    local ingress_manifest="${DIR}/cluster/eks/manifest/eks-operator-ingress.yaml"

    if [[ ! -f "$ingress_manifest" ]]; then
        log_warning "EKS operator ingress manifest not found, creating default ingress"

        cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backstage
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
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

    log_success "EKS Operator ingress applied successfully"
}

cleanup_eks_operator_deployment() {
    local namespace="$1"

    log_section "Cleaning up EKS Operator deployment"

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
    log_header "EKS Operator Deployment Job"

    # Setup EKS cluster
    setup_eks_cluster

    # Setup operator
    cluster_setup_k8s_operator
    prepare_operator "3"

    # Deploy standard RHDH with Operator
    log_section "Standard RHDH Operator Deployment"
    deploy_eks_operator \
        "$EKS_NAMESPACE" \
        "$EKS_RELEASE_NAME" \
        "$EKS_VALUE_FILE" \
        "$EKS_DIFF_VALUE_FILE" \
        "false"

    # Cleanup standard deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_eks_operator_deployment "$EKS_NAMESPACE"
    fi

    # Deploy RBAC-enabled RHDH with Operator
    log_section "RBAC-enabled RHDH Operator Deployment"
    deploy_eks_operator \
        "$EKS_NAMESPACE_RBAC" \
        "$EKS_RELEASE_NAME_RBAC" \
        "$EKS_RBAC_VALUE_FILE" \
        "$EKS_RBAC_DIFF_VALUE_FILE" \
        "true"

    # Cleanup RBAC deployment
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_eks_operator_deployment "$EKS_NAMESPACE_RBAC"
    fi

    log_success "EKS Operator deployment job completed successfully"
}

# Execute main function
main "$@"