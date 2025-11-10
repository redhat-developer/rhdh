#!/bin/bash
# OpenShift-specific platform functions for RHDH CI/CD Pipeline

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source core modules
# shellcheck source=../../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"
# shellcheck source=./common.sh
source "${PIPELINES_ROOT}/modules/platform/common.sh"

# ============================================================================
# OpenShift Operators Installation
# ============================================================================

# Install Crunchy Postgres Operator for OpenShift
# Usage: install_crunchy_postgres_ocp_operator
install_crunchy_postgres_ocp_operator() {
  log_section "Installing Crunchy Postgres Operator for OpenShift"
  
  install_subscription \
    postgresql \
    openshift-operators \
    v5 \
    postgresql \
    community-operators \
    openshift-marketplace
  
  check_operator_status 300 "openshift-operators" "Crunchy Postgres for Kubernetes" "Succeeded"
  
  log_success "Crunchy Postgres Operator installed successfully"
}

# Install Red Hat OpenShift Pipelines Operator
# Usage: install_pipelines_operator
install_pipelines_operator() {
  local display_name="Red Hat OpenShift Pipelines"
  
  log_section "Installing Red Hat OpenShift Pipelines Operator"
  
  # Check if operator is already installed
  if oc get csv -n "openshift-operators" 2>/dev/null | grep -q "${display_name}"; then
    log_info "Red Hat OpenShift Pipelines operator is already installed"
    return 0
  fi
  
  log_info "Installing Red Hat OpenShift Pipelines operator..."
  
  install_subscription \
    openshift-pipelines-operator \
    openshift-operators \
    latest \
    openshift-pipelines-operator-rh \
    redhat-operators \
    openshift-marketplace
  
  wait_for_deployment "openshift-operators" "pipelines"
  wait_for_endpoint "tekton-pipelines-webhook" "openshift-pipelines"
  
  log_success "Red Hat OpenShift Pipelines operator installed successfully"
}

# Install Advanced Cluster Management (ACM) Operator
# Usage: install_acm_ocp_operator
install_acm_ocp_operator() {
  log_section "Installing Advanced Cluster Management Operator"
  
  local namespace="open-cluster-management"
  
  # Ensure namespace exists
  oc create namespace "${namespace}" --dry-run=client -o yaml | oc apply -f -
  
  # Create OperatorGroup
  log_info "Creating OperatorGroup for ACM"
  oc apply -f - << EOD
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: ${namespace}
  namespace: ${namespace}
spec:
  targetNamespaces:
    - ${namespace}
EOD
  
  # Install subscription
  install_subscription \
    advanced-cluster-management \
    ${namespace} \
    release-2.14 \
    advanced-cluster-management \
    redhat-operators \
    openshift-marketplace
  
  wait_for_deployment "${namespace}" "multiclusterhub-operator"
  wait_for_endpoint "multiclusterhub-operator-webhook" "${namespace}"
  
  log_success "Advanced Cluster Management operator installed successfully"
}

# Install OpenShift Serverless Operator (Knative)
# Usage: install_serverless_ocp_operator
install_serverless_ocp_operator() {
  log_section "Installing OpenShift Serverless Operator"
  
  install_subscription \
    serverless-operator \
    openshift-operators \
    stable \
    serverless-operator \
    redhat-operators \
    openshift-marketplace
  
  check_operator_status 300 "openshift-operators" "Red Hat OpenShift Serverless" "Succeeded"
  
  log_success "OpenShift Serverless operator installed successfully"
}

# Install OpenShift Serverless Logic Operator (SonataFlow)
# Usage: install_serverless_logic_ocp_operator
install_serverless_logic_ocp_operator() {
  log_section "Installing OpenShift Serverless Logic Operator"
  
  install_subscription \
    logic-operator-rhel8 \
    openshift-operators \
    alpha \
    logic-operator-rhel8 \
    redhat-operators \
    openshift-marketplace
  
  check_operator_status 300 "openshift-operators" "OpenShift Serverless Logic Operator" "Succeeded"
  
  log_success "OpenShift Serverless Logic operator installed successfully"
}

# ============================================================================
# Orchestrator Infrastructure Setup
# ============================================================================

# Install orchestrator infrastructure chart
# Usage: install_orchestrator_infra_chart
install_orchestrator_infra_chart() {
  local orch_infra_ns="orchestrator-infra"
  
  log_section "Installing Orchestrator Infrastructure Chart"
  
  configure_namespace "${orch_infra_ns}"
  
  log_info "Deploying orchestrator-infra chart (version: ${CHART_VERSION})"
  
  helm upgrade -i orch-infra -n "${orch_infra_ns}" \
    "oci://quay.io/rhdh/orchestrator-infra-chart" \
    --version "${CHART_VERSION}" \
    --wait --timeout=5m \
    --set serverlessLogicOperator.subscription.spec.installPlanApproval=Automatic \
    --set serverlessOperator.subscription.spec.installPlanApproval=Automatic
  
  # Wait for openshift-serverless pods
  log_info "Waiting for openshift-serverless pods to be created"
  until [[ $(oc get pods -n openshift-serverless --no-headers 2> /dev/null | wc -l) -gt 0 ]]; do
    sleep 5
  done
  
  # Wait for openshift-serverless-logic pods
  log_info "Waiting for openshift-serverless-logic pods to be created"
  until [[ $(oc get pods -n openshift-serverless-logic --no-headers 2> /dev/null | wc -l) -gt 0 ]]; do
    sleep 5
  done
  
  # Wait for all pods to be ready
  log_info "Waiting for all pods to be ready in openshift-serverless namespace"
  oc wait pod --all --for=condition=Ready --namespace=openshift-serverless --timeout=5m
  
  log_info "Waiting for all pods to be ready in openshift-serverless-logic namespace"
  oc wait pod --all --for=condition=Ready --namespace=openshift-serverless-logic --timeout=5m
  
  # Verify CRDs
  log_info "Verifying CRDs"
  oc get crd | grep "sonataflow" || log_warning "Sonataflow CRDs not found"
  oc get crd | grep "knative" || log_warning "Serverless CRDs not found"
  
  log_success "Orchestrator infrastructure chart installed successfully"
}

# ============================================================================
# Note: Tekton Pipelines functions moved to common.sh
# Use install_tekton_pipelines_k8s from common.sh for Kubernetes clusters
# For OpenShift, use install_pipelines_operator above
# ============================================================================

# ============================================================================
# Cluster Setup Functions
# ============================================================================

# Setup OpenShift cluster for Helm deployments
# Usage: cluster_setup_ocp_helm
cluster_setup_ocp_helm() {
  log_section "Setting up OpenShift Cluster for Helm Deployments"
  
  install_pipelines_operator
  install_acm_ocp_operator
  install_crunchy_postgres_ocp_operator

  # Conditionally deploy orchestrator workflows
  if [[ "${DEPLOY_ORCHESTRATOR_WORKFLOWS:-true}" == "true" ]]; then
    install_orchestrator_infra_chart
  else
    log_info "Skipping orchestrator-infra chart deployment (DEPLOY_ORCHESTRATOR_WORKFLOWS=false)"
  fi
  
  log_success "OpenShift cluster setup completed for Helm deployments"
}

# Setup OpenShift cluster for Operator deployments
# Usage: cluster_setup_ocp_operator
cluster_setup_ocp_operator() {
  log_section "Setting up OpenShift Cluster for Operator Deployments"
  
  install_pipelines_operator
  install_acm_ocp_operator
  install_crunchy_postgres_ocp_operator
  install_serverless_ocp_operator
  install_serverless_logic_ocp_operator
  
  log_success "OpenShift cluster setup completed for Operator deployments"
}

# Setup Kubernetes cluster for Helm deployments
# Usage: cluster_setup_k8s_helm
cluster_setup_k8s_helm() {
  log_section "Setting up Kubernetes Cluster for Helm Deployments"
  
  install_tekton_pipelines_k8s
  # Note: OCM and Crunchy Postgres work with K8s but are disabled in values file
  
  log_success "Kubernetes cluster setup completed for Helm deployments"
}

# Setup Kubernetes cluster for Operator deployments
# Usage: cluster_setup_k8s_operator
cluster_setup_k8s_operator() {
  log_section "Setting up Kubernetes Cluster for Operator Deployments"
  
  install_olm
  install_tekton_pipelines_k8s
  # Note: OCM and Crunchy Postgres work with K8s but are disabled in values file
  
  log_success "Kubernetes cluster setup completed for Operator deployments"
}

# ============================================================================
# Platform Detection (using common.sh functions)
# ============================================================================

# Detect OpenShift platform (wrapper for common function)
# Usage: detect_ocp
detect_ocp() {
  detect_platform_type
}

# ============================================================================
# Export Functions
# ============================================================================
export -f install_crunchy_postgres_ocp_operator
export -f install_pipelines_operator
export -f install_acm_ocp_operator
export -f install_serverless_ocp_operator
export -f install_serverless_logic_ocp_operator
export -f install_orchestrator_infra_chart
export -f cluster_setup_ocp_helm
export -f cluster_setup_ocp_operator
export -f cluster_setup_k8s_helm
export -f cluster_setup_k8s_operator
export -f detect_ocp

