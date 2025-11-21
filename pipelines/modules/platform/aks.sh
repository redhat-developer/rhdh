#!/bin/bash
# Azure Kubernetes Service (AKS) specific platform functions for RHDH CI/CD Pipeline

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source core modules
# shellcheck source=../../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"
# shellcheck source=./common.sh
source "${PIPELINES_ROOT}/modules/platform/common.sh"

# ============================================================================
# AKS Cluster Authentication
# ============================================================================

# Login to AKS cluster using Azure credentials
# Usage: login_to_aks <resource-group> <cluster-name>
login_to_aks() {
  local resource_group=$1
  local cluster_name=$2
  
  log_section "Logging into AKS Cluster"
  log_info "Resource Group: ${resource_group}"
  log_info "Cluster Name: ${cluster_name}"
  
  # Check if Azure CLI is installed
  if ! command -v az &> /dev/null; then
    log_error "Azure CLI (az) is not installed"
    return 1
  fi
  
  # Get AKS credentials
  log_info "Getting AKS credentials..."
  az aks get-credentials \
    --resource-group "${resource_group}" \
    --name "${cluster_name}" \
    --overwrite-existing
  
  log_success "Successfully logged into AKS cluster"
}

# ============================================================================
# AKS-Specific Ingress Configuration
# ============================================================================

# Install NGINX Ingress Controller for AKS
# Usage: install_nginx_ingress_aks
install_nginx_ingress_aks() {
  log_section "Installing NGINX Ingress Controller for AKS"
  
  # Check if already installed
  if kubectl get namespace ingress-nginx &> /dev/null; then
    log_info "NGINX Ingress Controller is already installed"
    return 0
  fi
  
  log_info "Installing NGINX Ingress Controller using Helm..."
  
  # Add helm repo
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
  helm repo update
  
  # Install ingress controller
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --create-namespace \
    --set controller.service.annotations."service\.beta\.kubernetes\.io/azure-load-balancer-health-probe-request-path"=/healthz \
    --wait --timeout=5m
  
  # Wait for external IP
  log_info "Waiting for external IP to be assigned..."
  timeout 300 bash -c '
    while true; do
      EXTERNAL_IP=$(kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath="{.status.loadBalancer.ingress[0].ip}" 2>/dev/null)
      if [[ -n "${EXTERNAL_IP}" ]]; then
        echo "External IP assigned: ${EXTERNAL_IP}"
        break
      fi
      echo "Waiting for external IP..."
      sleep 10
    done
  ' || log_warning "Timeout waiting for external IP"
  
  log_success "NGINX Ingress Controller installed successfully"
}

# Get AKS ingress controller external IP
# Usage: external_ip=$(get_aks_ingress_ip)
get_aks_ingress_ip() {
  local external_ip=$(kubectl get svc ingress-nginx-controller -n ingress-nginx \
    -o jsonpath="{.status.loadBalancer.ingress[0].ip}" 2>/dev/null || echo "")
  
  if [[ -n "${external_ip}" ]]; then
    echo "${external_ip}"
    return 0
  fi
  
  log_error "Could not get AKS ingress external IP"
  return 1
}

# ============================================================================
# AKS Storage Configuration
# ============================================================================

# Configure Azure Disk storage class (if needed)
# Usage: configure_aks_storage
configure_aks_storage() {
  log_section "Configuring AKS Storage"
  
  # Check if default storage class exists
  if kubectl get storageclass default &> /dev/null; then
    log_info "Default storage class already exists"
    return 0
  fi
  
  # Set managed-premium as default if available
  if kubectl get storageclass managed-premium &> /dev/null; then
    log_info "Setting managed-premium as default storage class"
    kubectl patch storageclass managed-premium -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
  elif kubectl get storageclass managed &> /dev/null; then
    log_info "Setting managed as default storage class"
    kubectl patch storageclass managed -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
  else
    log_warning "No suitable storage class found to set as default"
  fi
  
  log_success "AKS storage configuration completed"
}

# ============================================================================
# AKS-Specific Operators and Add-ons
# ============================================================================

# Install Cert-Manager for AKS (for TLS certificates)
# Usage: install_cert_manager_aks
install_cert_manager_aks() {
  log_section "Installing Cert-Manager for AKS"
  
  # Check if already installed
  if kubectl get namespace cert-manager &> /dev/null; then
    log_info "Cert-Manager is already installed"
    return 0
  fi
  
  log_info "Installing Cert-Manager..."
  
  # Install cert-manager CRDs
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
  
  # Wait for cert-manager to be ready
  log_info "Waiting for Cert-Manager pods to be ready..."
  kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=5m
  
  log_success "Cert-Manager installed successfully"
}

# Install Azure Workload Identity (for pod identities)
# Usage: install_azure_workload_identity
install_azure_workload_identity() {
  log_section "Installing Azure Workload Identity"
  
  # Check if already installed
  if kubectl get namespace azure-workload-identity-system &> /dev/null; then
    log_info "Azure Workload Identity is already installed"
    return 0
  fi
  
  log_info "Installing Azure Workload Identity..."
  
  # Add helm repo
  helm repo add azure-workload-identity https://azure.github.io/azure-workload-identity/charts
  helm repo update
  
  # Install workload identity
  helm upgrade --install workload-identity-webhook azure-workload-identity/workload-identity-webhook \
    --namespace azure-workload-identity-system \
    --create-namespace \
    --set azureTenantID="${AZURE_TENANT_ID:-}" \
    --wait --timeout=5m
  
  log_success "Azure Workload Identity installed successfully"
}

# ============================================================================
# AKS Cluster Setup Functions
# ============================================================================

# Setup AKS cluster for Helm deployments
# Usage: cluster_setup_aks_helm
cluster_setup_aks_helm() {
  log_section "Setting up AKS Cluster for Helm Deployments"
  
  # Validate cluster access
  validate_cluster_access
  
  # Install OLM (for operator support)
  install_olm
  
  # Install Tekton Pipelines
  install_tekton_pipelines_k8s
  
  # Install NGINX Ingress Controller
  install_nginx_ingress_aks
  
  # Configure storage
  configure_aks_storage
  
  # Install Cert-Manager (optional, for TLS)
  install_cert_manager_aks
  
  log_success "AKS cluster setup completed for Helm deployments"
}

# Setup AKS cluster for Operator deployments
# Usage: cluster_setup_aks_operator
cluster_setup_aks_operator() {
  log_section "Setting up AKS Cluster for Operator Deployments"
  
  # Validate cluster access
  validate_cluster_access
  
  # Install OLM
  install_olm
  
  # Install Tekton Pipelines
  install_tekton_pipelines_k8s
  
  # Install NGINX Ingress Controller
  install_nginx_ingress_aks
  
  # Configure storage
  configure_aks_storage
  
  log_success "AKS cluster setup completed for Operator deployments"
}

# ============================================================================
# AKS-Specific Cleanup Functions
# ============================================================================

# Cleanup AKS-specific resources
# Usage: cleanup_aks_resources
cleanup_aks_resources() {
  log_section "Cleaning up AKS-specific resources"
  
  # Delete NGINX ingress controller (optional)
  if [[ "${CLEANUP_INGRESS:-false}" == "true" ]]; then
    log_info "Deleting NGINX Ingress Controller..."
    helm uninstall ingress-nginx -n ingress-nginx || true
    kubectl delete namespace ingress-nginx --ignore-not-found=true
  fi
  
  # Delete Cert-Manager (optional)
  if [[ "${CLEANUP_CERT_MANAGER:-false}" == "true" ]]; then
    log_info "Deleting Cert-Manager..."
    kubectl delete -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml --ignore-not-found=true
  fi
  
  log_success "AKS resource cleanup completed"
}

# ============================================================================
# Export Functions
# ============================================================================
export -f login_to_aks
export -f install_nginx_ingress_aks
export -f get_aks_ingress_ip
export -f configure_aks_storage
export -f install_cert_manager_aks
export -f install_azure_workload_identity
export -f cluster_setup_aks_helm
export -f cluster_setup_aks_operator
export -f cleanup_aks_resources



