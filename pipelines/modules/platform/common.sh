#!/bin/bash
# Common platform functions shared across all Kubernetes platforms
# This module provides abstractions for operations that work the same way
# on OpenShift, AKS, EKS, GKE, and other Kubernetes distributions

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source core modules
# shellcheck source=../../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"

# ============================================================================
# Platform Detection
# ============================================================================

# Check if current cluster is OpenShift
# Returns: 0 if OpenShift, 1 if plain Kubernetes
# Usage: if is_openshift; then ...; fi
is_openshift() {
  if command -v oc &> /dev/null; then
    local routes_check=$(oc api-resources 2>/dev/null | grep "route.openshift.io" || true)
    if [[ -n "${routes_check}" ]]; then
      return 0
    fi
  fi
  return 1
}

# Detect if cluster is OpenShift and export flag
# Usage: detect_platform_type
detect_platform_type() {
  log_info "Detecting platform type"
  
  if is_openshift; then
    export IS_OPENSHIFT="true"
    log_success "OpenShift platform detected"
    save_is_openshift "true"
  else
    export IS_OPENSHIFT="false"
    log_info "Kubernetes platform detected (not OpenShift)"
    save_is_openshift "false"
  fi
}

# Detect container platform and version
# Usage: detect_container_platform
detect_container_platform() {
  log_info "Detecting container platform and version"
  
  local platform="unknown"
  local version="unknown"
  
  # Try to detect OpenShift version
  if command -v oc &> /dev/null; then
    version=$(oc version -o json 2>/dev/null | jq -r '.openshiftVersion' 2>/dev/null || echo "unknown")
    if [[ "${version}" != "null" && "${version}" != "unknown" ]]; then
      platform="OpenShift"
    fi
  fi
  
  # Fallback to Kubernetes version
  if [[ "${platform}" == "unknown" ]] && command -v kubectl &> /dev/null; then
    version=$(kubectl version --short 2>/dev/null | grep -i server | awk '{print $3}' || echo "unknown")
    platform="Kubernetes"
  fi
  
  export CONTAINER_PLATFORM="${platform}"
  export CONTAINER_PLATFORM_VERSION="${version}"
  
  log_info "Detected platform: ${CONTAINER_PLATFORM} ${CONTAINER_PLATFORM_VERSION}"
  save_container_platform "${CONTAINER_PLATFORM}" "${CONTAINER_PLATFORM_VERSION}"
}

# ============================================================================
# Cluster Authentication
# ============================================================================

# Login to Kubernetes cluster using token and URL
# Usage: login_to_cluster <token> <url>
login_to_cluster() {
  local token=$1
  local url=$2
  
  log_section "Logging into Kubernetes Cluster"
  log_info "Cluster URL: ${url}"
  
  # Determine which CLI to use
  if is_openshift; then
    log_info "Using oc CLI for OpenShift"
    oc login --token="${token}" --server="${url}" --insecure-skip-tls-verify=true
  else
    log_info "Using kubectl CLI for Kubernetes"
    kubectl config set-cluster cluster --server="${url}" --insecure-skip-tls-verify=true
    kubectl config set-credentials user --token="${token}"
    kubectl config set-context context --cluster=cluster --user=user
    kubectl config use-context context
  fi
  
  log_success "Successfully logged into cluster"
}

# ============================================================================
# Ingress/Route Management
# ============================================================================

# Get the ingress base URL for the cluster
# OpenShift: uses router base (e.g., apps.cluster.com)
# Kubernetes: uses ingress controller domain or load balancer
# Usage: base_url=$(get_cluster_ingress_base)
get_cluster_ingress_base() {
  log_info "Detecting cluster ingress base URL"
  
  if is_openshift; then
    # OpenShift: Get router base from routes
    local router_base=$(oc get route -A -o json 2>/dev/null | \
      jq -r '.items[0].spec.host' 2>/dev/null | \
      sed 's/^[^.]*\.//' || echo "")
    
    if [[ -n "${router_base}" ]]; then
      echo "${router_base}"
      return 0
    fi
    
    # Fallback: try to get from ingress.config.openshift.io
    router_base=$(oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null || echo "")
    if [[ -n "${router_base}" ]]; then
      echo "${router_base}"
      return 0
    fi
  else
    # Kubernetes: Try to get from ingress resources
    local ingress_domain=$(kubectl get ingress -A -o json 2>/dev/null | \
      jq -r '.items[0].spec.rules[0].host' 2>/dev/null | \
      sed 's/^[^.]*\.//' || echo "")
    
    if [[ -n "${ingress_domain}" ]]; then
      echo "${ingress_domain}"
      return 0
    fi
    
    # Fallback: check for load balancer service
    local lb_ip=$(kubectl get svc -A -o json | \
      jq -r '.items[] | select(.spec.type=="LoadBalancer") | .status.loadBalancer.ingress[0].ip // .status.loadBalancer.ingress[0].hostname' 2>/dev/null | \
      head -n1 || echo "")
    
    if [[ -n "${lb_ip}" ]]; then
      echo "${lb_ip}"
      return 0
    fi
  fi
  
  log_error "Could not detect cluster ingress base URL"
  return 1
}

# Get the application URL for a deployed service
# Usage: app_url=$(get_application_url <namespace> <service-name>)
get_application_url() {
  local namespace=$1
  local service_name=$2
  
  if is_openshift; then
    # OpenShift: Get route URL
    local route_url=$(oc get route -n "${namespace}" -o json 2>/dev/null | \
      jq -r ".items[] | select(.spec.to.name==\"${service_name}\") | .spec.host" 2>/dev/null | \
      head -n1)
    
    if [[ -n "${route_url}" ]]; then
      echo "https://${route_url}"
      return 0
    fi
  else
    # Kubernetes: Get ingress URL
    local ingress_host=$(kubectl get ingress -n "${namespace}" -o json 2>/dev/null | \
      jq -r ".items[] | select(.spec.rules[].http.paths[].backend.service.name==\"${service_name}\") | .spec.rules[0].host" 2>/dev/null | \
      head -n1)
    
    if [[ -n "${ingress_host}" ]]; then
      echo "https://${ingress_host}"
      return 0
    fi
    
    # Fallback: check for LoadBalancer service
    local lb_url=$(kubectl get svc "${service_name}" -n "${namespace}" -o json 2>/dev/null | \
      jq -r 'if .spec.type == "LoadBalancer" then (.status.loadBalancer.ingress[0].ip // .status.loadBalancer.ingress[0].hostname) else empty end' 2>/dev/null)
    
    if [[ -n "${lb_url}" ]]; then
      echo "http://${lb_url}"
      return 0
    fi
  fi
  
  log_error "Could not determine application URL for service ${service_name} in namespace ${namespace}"
  return 1
}

# ============================================================================
# CLI Wrapper Functions
# ============================================================================

# Execute kubectl/oc command based on platform
# Usage: k8s_cli get pods -n namespace
k8s_cli() {
  if is_openshift; then
    oc "$@"
  else
    kubectl "$@"
  fi
}

# Apply a Kubernetes resource file
# Usage: apply_resource <file-path>
apply_resource() {
  local file_path=$1
  
  log_info "Applying Kubernetes resource: ${file_path}"
  k8s_cli apply -f "${file_path}"
}

# Delete a Kubernetes resource file
# Usage: delete_resource <file-path>
delete_resource() {
  local file_path=$1
  
  log_info "Deleting Kubernetes resource: ${file_path}"
  k8s_cli delete -f "${file_path}" --ignore-not-found=true
}

# ============================================================================
# Operator Lifecycle Manager (OLM)
# ============================================================================

# Check if OLM is installed
# Usage: if is_olm_installed; then ...; fi
is_olm_installed() {
  if k8s_cli get ns olm &> /dev/null; then
    return 0
  fi
  return 1
}

# Install OLM (for non-OpenShift clusters)
# Usage: install_olm
install_olm() {
  log_section "Installing Operator Lifecycle Manager (OLM)"
  
  if is_olm_installed; then
    log_info "OLM is already installed"
    return 0
  fi
  
  if is_openshift; then
    log_info "OpenShift has built-in OLM, skipping installation"
    return 0
  fi
  
  log_info "Installing OLM on Kubernetes cluster"
  local olm_version="v0.28.0"
  
  kubectl apply -f "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/${olm_version}/crds.yaml"
  kubectl apply -f "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/${olm_version}/olm.yaml"
  
  # Wait for OLM pods to be ready
  log_info "Waiting for OLM pods to be ready"
  kubectl wait --for=condition=Ready pods -l app=olm-operator -n olm --timeout=5m
  kubectl wait --for=condition=Ready pods -l app=catalog-operator -n olm --timeout=5m
  
  log_success "OLM installed successfully"
}

# ============================================================================
# Tekton Pipelines
# ============================================================================

# Check if Tekton Pipelines is installed
# Usage: if is_tekton_installed; then ...; fi
is_tekton_installed() {
  if is_openshift; then
    # Check for OpenShift Pipelines
    if oc get csv -n openshift-operators 2>/dev/null | grep -q "Red Hat OpenShift Pipelines"; then
      return 0
    fi
  else
    # Check for Tekton Pipelines namespace
    if kubectl get ns tekton-pipelines &> /dev/null; then
      return 0
    fi
  fi
  return 1
}

# Install Tekton Pipelines (Kubernetes only)
# For OpenShift, use platform-specific function
# Usage: install_tekton_pipelines_k8s
install_tekton_pipelines_k8s() {
  local display_name="tekton-pipelines-webhook"
  
  log_section "Installing Tekton Pipelines"
  
  if is_tekton_installed; then
    log_info "Tekton Pipelines are already installed"
    return 0
  fi
  
  if is_openshift; then
    log_error "Use install_pipelines_operator for OpenShift"
    return 1
  fi
  
  log_info "Installing Tekton Pipelines on Kubernetes"
  kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
  
  wait_for_deployment "tekton-pipelines" "${display_name}"
  wait_for_endpoint "tekton-pipelines-webhook" "tekton-pipelines"
  
  log_success "Tekton Pipelines installed successfully"
}

# Delete Tekton Pipelines
# Usage: delete_tekton_pipelines
delete_tekton_pipelines() {
  log_section "Deleting Tekton Pipelines"
  
  if is_openshift; then
    log_warning "Cannot delete OpenShift Pipelines operator from here"
    return 1
  fi
  
  # Check if tekton-pipelines namespace exists
  if ! kubectl get namespace tekton-pipelines &> /dev/null; then
    log_info "Tekton Pipelines is not installed. Nothing to delete"
    return 0
  fi
  
  log_info "Found Tekton Pipelines installation. Attempting to delete..."
  
  # Delete the resources and ignore errors
  kubectl delete -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml \
    --ignore-not-found=true 2> /dev/null || true
  
  # Wait for namespace deletion (with timeout)
  log_info "Waiting for Tekton Pipelines namespace to be deleted"
  timeout 30 bash -c '
    while kubectl get namespace tekton-pipelines &> /dev/null; do
      echo "Waiting for tekton-pipelines namespace deletion..."
      sleep 5
    done
    echo "Tekton Pipelines deleted successfully."
  ' || log_warning "Timed out waiting for namespace deletion, continuing..."
  
  log_success "Tekton Pipelines deletion completed"
}

# ============================================================================
# Common Setup Functions
# ============================================================================

# Perform basic cluster validation
# Usage: validate_cluster_access
validate_cluster_access() {
  log_section "Validating Cluster Access"
  
  log_info "Testing cluster connectivity..."
  k8s_cli cluster-info || {
    log_error "Cannot connect to cluster"
    return 1
  }
  
  log_info "Checking cluster version..."
  k8s_cli version --short || {
    log_error "Cannot retrieve cluster version"
    return 1
  }
  
  log_info "Checking permissions..."
  k8s_cli auth can-i create namespace || {
    log_warning "May not have permission to create namespaces"
  }
  
  log_success "Cluster access validated successfully"
}

# ============================================================================
# Export Functions
# ============================================================================
export -f is_openshift
export -f detect_platform_type
export -f detect_container_platform
export -f login_to_cluster
export -f get_cluster_ingress_base
export -f get_application_url
export -f k8s_cli
export -f apply_resource
export -f delete_resource
export -f is_olm_installed
export -f install_olm
export -f is_tekton_installed
export -f install_tekton_pipelines_k8s
export -f delete_tekton_pipelines
export -f validate_cluster_access


