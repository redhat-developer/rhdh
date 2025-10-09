#!/usr/bin/env bash
#
# Tekton Module - OpenShift Pipelines and Tekton-related functions
#

# Guard to prevent multiple sourcing
if [[ -n "${_TEKTON_LOADED:-}" ]]; then
    return 0
fi
readonly _TEKTON_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/k8s-operations.sh"

# ============================================================================
# TEKTON OPERATOR INSTALLATION
# ============================================================================

install_pipelines_operator() {
    log_info "Installing OpenShift Pipelines Operator"

    if resource_exists "csv" "openshift-pipelines-operator" "openshift-operators"; then
        log_info "Pipelines operator already installed"
        return 0
    fi

    kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: openshift-pipelines-operator
  namespace: openshift-operators
spec:
  channel: latest
  name: openshift-pipelines-operator-rh
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF

    # Wait for operator to be ready
    sleep 30
    log_success "Pipelines operator installation initiated"
}

# ============================================================================
# TEKTON PIPELINES DEPLOYMENT
# ============================================================================

deploy_tekton_pipelines() {
    local namespace="$1"

    log_info "Deploying Tekton pipelines to namespace ${namespace}"

    # Apply pipeline resources
    local pipeline_dir="${DIR}/resources/pipeline-run"

    if [[ -d "${pipeline_dir}" ]]; then
        log_info "Applying pipeline definitions"

        # Apply pipeline definitions
        if [[ -f "${pipeline_dir}/hello-world-pipeline.yaml" ]]; then
            kubectl apply -f "${pipeline_dir}/hello-world-pipeline.yaml" -n "${namespace}"
            log_success "Applied hello-world pipeline"
        fi

        # Apply pipeline runs
        if [[ -f "${pipeline_dir}/hello-world-pipeline-run.yaml" ]]; then
            kubectl apply -f "${pipeline_dir}/hello-world-pipeline-run.yaml" -n "${namespace}"
            log_success "Applied hello-world pipeline run"
        fi
    else
        log_warning "Pipeline directory not found: ${pipeline_dir}"
    fi
}

# ============================================================================
# TEKTON TOPOLOGY TEST
# ============================================================================

deploy_tekton_topology_test() {
    local namespace="$1"

    log_info "Deploying Tekton topology test resources"

    local topology_dir="${DIR}/resources/topology_test"

    if [[ -d "${topology_dir}" ]]; then
        for file in "${topology_dir}"/*.yaml; do
            [[ -f "$file" ]] || continue
            log_info "Applying topology test: $(basename "$file")"
            kubectl apply -f "$file" -n "${namespace}"
        done
        log_success "Topology test resources deployed"
    else
        log_warning "Topology test directory not found: ${topology_dir}"
    fi
}

# ============================================================================
# TEKTON VERIFICATION
# ============================================================================

verify_tekton_installation() {
    log_info "Verifying Tekton installation"

    # Check if Tekton CRDs are available
    if kubectl api-resources | grep -q "tekton.dev"; then
        log_success "Tekton CRDs are available"
    else
        log_error "Tekton CRDs not found"
        return 1
    fi

    # Check Tekton operator status
    if kubectl get deployment tekton-pipelines-controller -n openshift-pipelines &>/dev/null; then
        local ready
        ready=$(kubectl get deployment tekton-pipelines-controller -n openshift-pipelines \
            -o jsonpath='{.status.readyReplicas}')

        if [[ "$ready" -ge 1 ]]; then
            log_success "Tekton controller is ready"
        else
            log_warning "Tekton controller not ready"
        fi
    else
        log_warning "Tekton controller deployment not found"
    fi

    # Check webhook
    if kubectl get deployment tekton-pipelines-webhook -n openshift-pipelines &>/dev/null; then
        log_success "Tekton webhook found"
    else
        log_warning "Tekton webhook not found"
    fi
}

# ============================================================================
# TEKTON PIPELINE OPERATIONS
# ============================================================================

run_tekton_pipeline() {
    local namespace="$1"
    local pipeline_name="$2"
    local pipeline_run_name="${3:-${pipeline_name}-run-$(date +%s)}"

    log_info "Running Tekton pipeline: ${pipeline_name}"

    # Create pipeline run
    kubectl create -f - <<EOF
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  name: ${pipeline_run_name}
  namespace: ${namespace}
spec:
  pipelineRef:
    name: ${pipeline_name}
  workspaces:
  - name: shared-data
    volumeClaimTemplate:
      spec:
        accessModes:
        - ReadWriteOnce
        resources:
          requests:
            storage: 1Gi
EOF

    log_info "Pipeline run created: ${pipeline_run_name}"

    # Wait for pipeline to complete (optional)
    if [[ "${WAIT_FOR_PIPELINE:-false}" == "true" ]]; then
        kubectl wait --for=condition=Succeeded pipelinerun/${pipeline_run_name} \
            -n "${namespace}" --timeout=300s || {
            log_error "Pipeline run did not complete successfully"
            return 1
        }
        log_success "Pipeline run completed successfully"
    fi
}

list_tekton_pipelines() {
    local namespace="${1:-}"

    log_info "Listing Tekton pipelines"

    if [[ -n "${namespace}" ]]; then
        kubectl get pipelines -n "${namespace}"
        kubectl get pipelineruns -n "${namespace}"
    else
        kubectl get pipelines --all-namespaces
        kubectl get pipelineruns --all-namespaces
    fi
}

cleanup_tekton_resources() {
    local namespace="$1"
    local max_age="${2:-7}" # Days

    log_info "Cleaning up old Tekton pipeline runs (older than ${max_age} days)"

    # Delete old pipeline runs
    kubectl get pipelineruns -n "${namespace}" -o json | \
        jq -r --arg age "${max_age}" '.items[] |
        select(.metadata.creationTimestamp | fromdateiso8601 < (now - ($age | tonumber * 86400))) |
        .metadata.name' | \
        while read -r run; do
            log_info "Deleting old pipeline run: ${run}"
            kubectl delete pipelinerun "${run}" -n "${namespace}"
        done

    log_success "Tekton cleanup completed"
}

# ============================================================================
# TEKTON TRIGGERS
# ============================================================================

setup_tekton_triggers() {
    local namespace="$1"

    log_info "Setting up Tekton triggers"

    # Install triggers if not already installed
    if ! kubectl get deployment tekton-triggers-controller -n openshift-pipelines &>/dev/null; then
        log_warning "Tekton Triggers not installed, skipping trigger setup"
        return 0
    fi

    # Create event listener
    kubectl apply -f - <<EOF
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: github-listener
  namespace: ${namespace}
spec:
  serviceAccountName: pipeline
  triggers:
  - name: github-push
    interceptors:
    - ref:
        name: github
      params:
      - name: secretRef
        value:
          secretName: github-webhook-secret
          secretKey: secret
    - ref:
        name: cel
      params:
      - name: filter
        value: "header.match('X-GitHub-Event', 'push')"
    bindings:
    - ref: github-push-binding
    template:
      ref: github-push-template
EOF

    log_success "Tekton triggers configured"
}

# Export functions
export -f install_pipelines_operator deploy_tekton_pipelines
export -f deploy_tekton_topology_test verify_tekton_installation
export -f run_tekton_pipeline list_tekton_pipelines cleanup_tekton_resources
export -f setup_tekton_triggers