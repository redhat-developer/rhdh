#!/usr/bin/env bash
#
# Tekton and Topology Plugin Support Module
#
set -euo pipefail

# Guard to prevent multiple sourcing
if [[ -n "${_TEKTON_TOPOLOGY_LOADED:-}}" ]]; then
    return 0
fi
readonly _TEKTON_TOPOLOGY_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/kubectl.sh"

# ============================================================================
# TEKTON CONFIGURATION
# ============================================================================

check_tekton_installed() {
    log_debug "Checking if Tekton is installed"

    if kubectl get crd pipelines.tekton.dev &>/dev/null; then
        log_info "Tekton CRDs found"
        return 0
    else
        log_warning "Tekton CRDs not found"
        return 1
    fi
}

install_tekton_pipelines() {
    local namespace="${1:-tekton-pipelines}"

    log_section "Installing Tekton Pipelines"

    # Check if already installed
    if check_tekton_installed; then
        log_info "Tekton already installed"
        return 0
    fi

    # Install Tekton Pipelines
    local tekton_version="${TEKTON_VERSION:-v0.53.0}"
    log_info "Installing Tekton Pipelines ${tekton_version}"

    kubectl apply --filename "https://storage.googleapis.com/tekton-releases/pipeline/previous/${tekton_version}/release.yaml"

    # Wait for Tekton to be ready
    wait_for_deployment "${namespace}" "tekton-pipelines-controller"
    wait_for_deployment "${namespace}" "tekton-pipelines-webhook"

    log_success "Tekton Pipelines installed successfully"
}

deploy_tekton_test_resources() {
    local namespace="${1}"

    log_info "Deploying Tekton test resources to namespace: ${namespace}"

    # Create hello-world pipeline
    cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: hello-world-pipeline
  namespace: ${namespace}
spec:
  tasks:
    - name: hello-world
      taskSpec:
        steps:
          - name: echo
            image: alpine
            script: |
              #!/bin/sh
              echo "Hello World from Tekton!"
              echo "Namespace: ${namespace}"
              date
EOF

    # Create pipeline run
    cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: tekton.dev/v1beta1
kind: PipelineRun
metadata:
  name: hello-world-pipeline-run-$(date +%s)
  namespace: ${namespace}
spec:
  pipelineRef:
    name: hello-world-pipeline
EOF

    log_success "Tekton test resources deployed"
}

# ============================================================================
# TOPOLOGY CONFIGURATION
# ============================================================================

deploy_topology_test_app() {
    local namespace="${1}"

    log_info "Deploying Topology test application to namespace: ${namespace}"

    # Create test deployment for topology visualization
    cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: topology-test-app
  namespace: ${namespace}
  labels:
    app: topology-test
    app.kubernetes.io/name: topology-test
    app.kubernetes.io/instance: test
    app.kubernetes.io/component: frontend
    app.openshift.io/runtime: nodejs
    backstage.io/kubernetes-id: topology-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: topology-test
  template:
    metadata:
      labels:
        app: topology-test
        app.kubernetes.io/name: topology-test
        app.kubernetes.io/instance: test
        app.kubernetes.io/component: frontend
        backstage.io/kubernetes-id: topology-test
    spec:
      containers:
      - name: topology-test
        image: quay.io/redhatdemo/topology-test:latest
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 8080
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "100m"
---
apiVersion: v1
kind: Service
metadata:
  name: topology-test-app
  namespace: ${namespace}
  labels:
    app: topology-test
    app.kubernetes.io/name: topology-test
    app.kubernetes.io/instance: test
    backstage.io/kubernetes-id: topology-test
spec:
  selector:
    app: topology-test
  ports:
  - port: 8080
    targetPort: 8080
    name: http
  type: ClusterIP
EOF

    # Create ingress/route based on platform
    if [[ "${IS_OPENSHIFT:-false}" == "true" ]]; then
        create_topology_openshift_route "${namespace}"
    else
        create_topology_k8s_ingress "${namespace}"
    fi

    log_success "Topology test application deployed"
}

create_topology_openshift_route() {
    local namespace="${1}"

    log_info "Creating OpenShift route for Topology test app"

    cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: topology-test-app
  namespace: ${namespace}
  labels:
    app: topology-test
    backstage.io/kubernetes-id: topology-test
spec:
  to:
    kind: Service
    name: topology-test-app
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
EOF
}

create_topology_k8s_ingress() {
    local namespace="${1}"

    log_info "Creating Kubernetes ingress for Topology test app"

    cat <<EOF | kubectl apply -n "${namespace}" -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: topology-test-app
  namespace: ${namespace}
  labels:
    app: topology-test
    backstage.io/kubernetes-id: topology-test
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: topology-test-${namespace}.${K8S_CLUSTER_ROUTER_BASE}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: topology-test-app
            port:
              number: 8080
EOF
}

patch_for_cloud_provider() {
    local namespace="${1}"
    local cloud_provider="${2}"

    log_info "Applying ${cloud_provider} specific patches for Tekton/Topology"

    case "${cloud_provider}" in
        aks)
            patch_for_aks "${namespace}"
            ;;
        eks)
            patch_for_eks "${namespace}"
            ;;
        gke)
            patch_for_gke "${namespace}"
            ;;
        *)
            log_debug "No specific patches for ${cloud_provider}"
            ;;
    esac
}

patch_for_aks() {
    local namespace="${1}"

    log_info "Applying AKS patches for Tekton/Topology"

    # Add Azure-specific annotations
    kubectl patch deployment topology-test-app -n "${namespace}" \
        --type='json' -p='[
            {
                "op": "add",
                "path": "/spec/template/metadata/annotations",
                "value": {
                    "azure.workload.identity/use": "true"
                }
            }
        ]' 2>/dev/null || true
}

patch_for_eks() {
    local namespace="${1}"

    log_info "Applying EKS patches for Tekton/Topology"

    # Add AWS-specific annotations
    kubectl patch deployment topology-test-app -n "${namespace}" \
        --type='json' -p='[
            {
                "op": "add",
                "path": "/spec/template/metadata/annotations",
                "value": {
                    "eks.amazonaws.com/compute-type": "fargate"
                }
            }
        ]' 2>/dev/null || true
}

patch_for_gke() {
    local namespace="${1}"

    log_info "Applying GKE patches for Tekton/Topology"

    # Add GKE-specific annotations
    kubectl patch deployment topology-test-app -n "${namespace}" \
        --type='json' -p='[
            {
                "op": "add",
                "path": "/spec/template/metadata/annotations",
                "value": {
                    "cloud.google.com/neg": "{\"ingress\": true}"
                }
            }
        ]' 2>/dev/null || true
}

verify_tekton_topology_integration() {
    local namespace="${1}"

    log_section "Verifying Tekton and Topology integration"

    # Check if Tekton resources are visible
    local pipelines=$(kubectl get pipelines -n "${namespace}" --no-headers 2>/dev/null | wc -l)
    local pipelineruns=$(kubectl get pipelineruns -n "${namespace}" --no-headers 2>/dev/null | wc -l)

    log_info "Found ${pipelines} pipelines and ${pipelineruns} pipeline runs"

    # Check if Topology app is running
    if kubectl get deployment topology-test-app -n "${namespace}" &>/dev/null; then
        log_success "Topology test app deployment found"

        # Wait for deployment to be ready
        wait_for_deployment "${namespace}" "topology-test-app" 60
    else
        log_warning "Topology test app not found"
    fi

    # Get topology app URL
    local topology_url=""
    if [[ "${IS_OPENSHIFT:-false}" == "true" ]]; then
        topology_url=$(kubectl get route topology-test-app -n "${namespace}" \
            -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
    else
        topology_url="topology-test-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
    fi

    if [[ -n "${topology_url}" ]]; then
        log_info "Topology test app URL: https://${topology_url}"

        # Test connectivity
        if curl -sSf "https://${topology_url}" -k --max-time 10 &>/dev/null; then
            log_success "Topology test app is accessible"
        else
            log_warning "Topology test app is not accessible"
        fi
    fi

    log_success "Tekton and Topology verification complete"
}

cleanup_tekton_topology_resources() {
    local namespace="${1}"

    log_info "Cleaning up Tekton and Topology test resources"

    # Delete topology test app
    kubectl delete deployment topology-test-app -n "${namespace}" 2>/dev/null || true
    kubectl delete service topology-test-app -n "${namespace}" 2>/dev/null || true
    kubectl delete ingress topology-test-app -n "${namespace}" 2>/dev/null || true
    kubectl delete route topology-test-app -n "${namespace}" 2>/dev/null || true

    # Delete Tekton test resources
    kubectl delete pipeline hello-world-pipeline -n "${namespace}" 2>/dev/null || true
    kubectl delete pipelinerun -l pipeline=hello-world-pipeline -n "${namespace}" 2>/dev/null || true

    log_success "Cleanup complete"
}

# ============================================================================
# EXPORT FUNCTIONS
# ============================================================================

export -f check_tekton_installed install_tekton_pipelines
export -f deploy_tekton_test_resources deploy_topology_test_app
export -f create_topology_openshift_route create_topology_k8s_ingress
export -f patch_for_cloud_provider patch_for_aks patch_for_eks patch_for_gke
export -f verify_tekton_topology_integration cleanup_tekton_topology_resources