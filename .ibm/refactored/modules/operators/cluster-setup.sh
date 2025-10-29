#!/usr/bin/env bash
#
# Cluster Setup Module - Install required operators and infrastructure
#

# Guard to prevent multiple sourcing
if [[ -n "${_CLUSTER_SETUP_LOADED:-}" ]]; then
    return 0
fi
readonly _CLUSTER_SETUP_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../k8s-operations.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../tekton.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../orchestrator.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../database/postgres.sh"

cluster_setup_ocp_helm() {
    log_info "Setting up OpenShift cluster for Helm deployments"

    # Install required operators (parallel where safe)
    install_pipelines_operator &
    local pid_pipelines=$!
    
    # Install ACM only if enabled (default: false, nightly: true)
    if [[ "${ENABLE_ACM:-false}" == "true" ]]; then
        log_info "ACM installation enabled"
        install_acm_operator &
        local pid_acm=$!
    else
        log_info "ACM installation disabled - skipping (use ENABLE_ACM=true to enable)"
    fi
    
    # Crunchy operator requires OLM resources; keep sequential to reduce flakiness
    wait ${pid_pipelines} 2>/dev/null || true
    if [[ "${ENABLE_ACM:-false}" == "true" ]]; then
        wait ${pid_acm} 2>/dev/null || true
    fi
    install_crunchy_postgres_operator

    # Install orchestrator infrastructure (only for nightly jobs)
    if [[ "${DEPLOY_ORCHESTRATOR:-false}" == "true" ]]; then
        log_info "Orchestrator deployment enabled - installing infrastructure"
        install_orchestrator_infra_chart
    else
        log_info "Orchestrator deployment disabled - skipping infrastructure installation"
    fi

    log_success "OpenShift cluster setup completed"
}

cluster_setup_ocp_operator() {
    log_info "Setting up OpenShift cluster for Operator deployments"

    # Install RHDH operator
    install_rhdh_operator

    # Install required operators
    install_pipelines_operator
    install_acm_operator

    log_success "OpenShift operator setup completed"
}

cluster_setup_k8s_operator() {
    log_info "Setting up Kubernetes cluster for Operator deployments"

    # Install OLM (Operator Lifecycle Manager) if not present
    install_olm

    # Install Tekton Pipelines
    install_tekton_pipelines

    # Install OCM operator if enabled (ACM for K8s)
    if [[ "${ENABLE_ACM:-false}" == "true" ]]; then
        log_info "Installing OCM operator for K8s"
        install_ocm_k8s_operator
        # Wait for MultiClusterHub to be ready
        wait_until_mch_ready
    fi

    # Install Crunchy Postgres operator if needed (disabled by default in values)
    # install_crunchy_postgres_k8s_operator

    log_success "Kubernetes operator setup completed"
}

cluster_setup_k8s_helm() {
    log_info "Setting up Kubernetes cluster for Helm deployments"

    # Add necessary Helm repositories
    helm repo add bitnami https://charts.bitnami.com/bitnami
    helm repo add stable https://charts.helm.sh/stable
    helm repo update

    # Install ingress controller if needed
    if ! resource_exists "deployment" "ingress-nginx-controller" "ingress-nginx"; then
        install_nginx_ingress
    fi

    log_success "Kubernetes cluster setup completed"
}

# Tekton/Pipelines operator function moved to modules/tekton.sh

install_acm_operator() {
    log_info "Installing Advanced Cluster Management Operator"

    if resource_exists "csv" "advanced-cluster-management" "open-cluster-management"; then
        log_info "ACM operator already installed"
        return 0
    fi

    # Create namespace
    kubectl create namespace open-cluster-management --dry-run=client -o yaml | kubectl apply -f -

    kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: open-cluster-management
  namespace: open-cluster-management
spec:
  targetNamespaces:
  - open-cluster-management
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: advanced-cluster-management
  namespace: open-cluster-management
spec:
  channel: release-2.9
  name: advanced-cluster-management
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF

    sleep 30
    log_success "ACM operator installation initiated"
    
    # Apply MultiClusterHub resource
    log_info "Creating MultiClusterHub resource"
    kubectl apply -f - <<EOF
apiVersion: operator.open-cluster-management.io/v1
kind: MultiClusterHub
metadata:
  name: multiclusterhub
  namespace: open-cluster-management
spec: {}
EOF
    
    log_success "MultiClusterHub resource created"
}

wait_until_mch_ready() {
    log_info "Waiting for MultiClusterHub to be ready (timeout: 10 min)"
    
    if ! kubectl wait multiclusterhub -n open-cluster-management multiclusterhub \
        --for=condition=Complete --timeout=600s 2>/dev/null; then
        log_warning "MultiClusterHub not ready after 10 min, checking status..."
        kubectl get multiclusterhub -n open-cluster-management multiclusterhub -o yaml || true
        return 1
    fi
    
    log_success "MultiClusterHub is ready"
}

# install_crunchy_postgres_operator function moved to modules/common.sh

# install_orchestrator_infra_chart function moved to modules/orchestrator.sh

install_rhdh_operator() {
    log_info "Installing RHDH Operator"

    if resource_exists "csv" "rhdh-operator" "rhdh-operator"; then
        log_info "RHDH operator already installed"
        return 0
    fi

    # Create namespace
    kubectl create namespace rhdh-operator --dry-run=client -o yaml | kubectl apply -f -

    kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: rhdh-operator
  namespace: rhdh-operator
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: rhdh-operator
  namespace: rhdh-operator
spec:
  channel: fast
  name: rhdh-operator
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF

    sleep 30
    log_success "RHDH operator installation initiated"
}

install_nginx_ingress() {
    log_info "Installing NGINX Ingress Controller"

    helm upgrade --install ingress-nginx ingress-nginx \
        --repo https://kubernetes.github.io/ingress-nginx \
        --namespace ingress-nginx \
        --create-namespace \
        --set controller.service.type=LoadBalancer \
        --wait --timeout 10m

    log_success "NGINX Ingress Controller installed"
}

install_olm() {
    log_info "Installing OLM (Operator Lifecycle Manager)"

    # Check if OLM is already installed
    if kubectl get namespace olm 2>/dev/null; then
        log_info "OLM is already installed"
        return 0
    fi

    # Install OLM
    local olm_version="${OLM_VERSION:-v0.28.0}"
    kubectl apply -f "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/${olm_version}/crds.yaml"
    kubectl wait --for=condition=Established --all crd --timeout=120s
    kubectl apply -f "https://github.com/operator-framework/operator-lifecycle-manager/releases/download/${olm_version}/olm.yaml"

    # Wait for OLM deployments to be ready
    kubectl wait --for=condition=available --timeout=300s deployment/olm-operator -n olm
    kubectl wait --for=condition=available --timeout=300s deployment/catalog-operator -n olm

    log_success "OLM installed successfully"
}

install_tekton_pipelines() {
    log_info "Installing Tekton Pipelines"

    # Check if Tekton is already installed
    if kubectl get namespace tekton-pipelines 2>/dev/null; then
        log_info "Tekton Pipelines is already installed"
        return 0
    fi

    # Install Tekton Pipelines
    local tekton_version="${TEKTON_VERSION:-v0.59.0}"
    kubectl apply -f "https://github.com/tektoncd/pipeline/releases/download/${tekton_version}/release.yaml"

    # Wait for Tekton deployments to be ready
    kubectl wait --for=condition=available --timeout=300s deployment/tekton-pipelines-controller -n tekton-pipelines
    kubectl wait --for=condition=available --timeout=300s deployment/tekton-pipelines-webhook -n tekton-pipelines

    log_success "Tekton Pipelines installed successfully"
}

install_ocm_k8s_operator() {
    log_info "Installing OCM operator for Kubernetes"

    # Check if OCM is already installed
    if kubectl get namespace open-cluster-management 2>/dev/null; then
        log_info "OCM operator is already installed"
        return 0
    fi

    # Create namespace
    kubectl create namespace open-cluster-management --dry-run=client -o yaml | kubectl apply -f -

    # Install OCM using OLM
    kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: open-cluster-management
  namespace: open-cluster-management
spec:
  targetNamespaces:
  - open-cluster-management
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: cluster-manager
  namespace: open-cluster-management
spec:
  channel: stable
  name: cluster-manager
  source: operatorhubio-catalog
  sourceNamespace: olm
EOF

    sleep 30
    log_success "OCM operator installation initiated"
}

# Export functions
export -f cluster_setup_ocp_helm cluster_setup_ocp_operator cluster_setup_k8s_helm cluster_setup_k8s_operator
export -f install_acm_operator wait_until_mch_ready install_rhdh_operator install_nginx_ingress
export -f install_olm install_tekton_pipelines install_ocm_k8s_operator