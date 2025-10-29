#!/usr/bin/env bash
#
# Orchestrator Module - All orchestrator-related functions
#

# Guard to prevent multiple sourcing
if [[ -n "${_ORCHESTRATOR_LOADED:-}" ]]; then
    return 0
fi
readonly _ORCHESTRATOR_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/k8s-operations.sh"

# ============================================================================
# ORCHESTRATOR INFRASTRUCTURE
# ============================================================================

install_orchestrator_infra_chart() {
    log_info "Installing Orchestrator Infrastructure"

    local ORCH_INFRA_NS="orchestrator-infra"

    # Create namespace
    kubectl create namespace "${ORCH_INFRA_NS}" --dry-run=client -o yaml | kubectl apply -f -

    log_info "Deploying orchestrator-infra chart"
    cd "${DIR}"
    helm upgrade -i orch-infra -n "${ORCH_INFRA_NS}" \
        "oci://quay.io/rhdh/orchestrator-infra-chart" --version "${CHART_VERSION}" \
        --wait --timeout=5m \
        --set serverlessLogicOperator.subscription.spec.installPlanApproval=Automatic \
        --set serverlessOperator.subscription.spec.installPlanApproval=Automatic

    log_success "Orchestrator infrastructure installed"
}

# ============================================================================
# ORCHESTRATOR WORKFLOWS
# ============================================================================

deploy_orchestrator_workflows() {
    local namespace="$1"

    log_info "Deploying orchestrator workflows to namespace ${namespace}"

    # Clone workflows repository
    local WORKFLOW_REPO="https://github.com/rhdh-orchestrator-test/serverless-workflows.git"
    local WORKFLOW_DIR="${DIR}/serverless-workflows"
    local WORKFLOW_MANIFESTS="${WORKFLOW_DIR}/workflows/experimentals/user-onboarding/manifests/"

    # Clean and clone fresh copy
    rm -rf "${WORKFLOW_DIR}"
    git clone "${WORKFLOW_REPO}" "${WORKFLOW_DIR}"

    # Determine PostgreSQL configuration based on namespace
    local pqsl_secret_name
    local pqsl_user_key
    local pqsl_password_key
    local pqsl_svc_name
    local patch_namespace

    if [[ "$namespace" == "${NAME_SPACE_RBAC}" ]]; then
        # RBAC uses external PostgreSQL
        pqsl_secret_name="postgres-cred"
        pqsl_user_key="POSTGRES_USER"
        pqsl_password_key="POSTGRES_PASSWORD"
        pqsl_svc_name="postgress-external-db-primary"
        patch_namespace="${NAME_SPACE_POSTGRES_DB}"
    else
        # Base uses internal PostgreSQL
        pqsl_secret_name="rhdh-postgresql-svcbind-postgres"
        pqsl_user_key="username"
        pqsl_password_key="password"
        pqsl_svc_name="rhdh-postgresql"
        patch_namespace="$namespace"
    fi

    # Apply workflow manifests
    log_info "Applying workflow manifests"
    kubectl apply -f "${WORKFLOW_MANIFESTS}" -n "${namespace}"

    # Install greeting workflow from Helm
    helm repo add orchestrator-workflows https://rhdhorchestrator.io/serverless-workflows || true
    helm repo update
    helm upgrade --install greeting orchestrator-workflows/greeting -n "${namespace}"

    # Wait for SonataFlow resources to be created
    log_info "Waiting for SonataFlow resources"
    local max_wait=60
    local count=0

    while [[ $count -lt $max_wait ]]; do
        local sf_count=$(kubectl get sf -n "${namespace}" --no-headers 2>/dev/null | wc -l)
        if [[ $sf_count -ge 2 ]]; then
            log_success "SonataFlow resources created"
            break
        fi
        log_debug "Waiting for SonataFlow resources (${sf_count}/2)..."
        sleep 5
        count=$((count + 1))
    done

    # Patch workflows with PostgreSQL configuration
    log_info "Configuring workflow persistence"
    for workflow in greeting user-onboarding; do
        if kubectl get sf "${workflow}" -n "${namespace}" &>/dev/null; then
            kubectl patch sonataflow "${workflow}" -n "${namespace}" --type merge \
                -p "{\"spec\": { \"persistence\": { \"postgresql\": { \"secretRef\": {\"name\": \"${pqsl_secret_name}\",\"userKey\": \"${pqsl_user_key}\",\"passwordKey\": \"${pqsl_password_key}\"},\"serviceRef\": {\"name\": \"${pqsl_svc_name}\",\"namespace\": \"${patch_namespace}\"}}}}}"

            log_success "Configured persistence for workflow: ${workflow}"
        else
            log_warning "Workflow ${workflow} not found, skipping persistence config"
        fi
    done

    # Clean up cloned repository
    rm -rf "${WORKFLOW_DIR}"

    log_success "Orchestrator workflows deployment completed"
}

# ============================================================================
# ORCHESTRATOR VERIFICATION
# ============================================================================

verify_orchestrator_workflows() {
    local namespace="$1"

    log_info "Verifying orchestrator workflows in namespace ${namespace}"

    # Check SonataFlow resources
    local workflows=$(kubectl get sf -n "${namespace}" -o jsonpath='{.items[*].metadata.name}')

    if [[ -z "${workflows}" ]]; then
        log_error "No SonataFlow workflows found"
        return 1
    fi

    for workflow in ${workflows}; do
        local status=$(kubectl get sf "${workflow}" -n "${namespace}" \
            -o jsonpath='{.status.conditions[?(@.type=="Running")].status}')

        if [[ "${status}" == "True" ]]; then
            log_success "Workflow ${workflow} is running"
        else
            log_warning "Workflow ${workflow} is not running (status: ${status})"
        fi
    done

    return 0
}

check_orchestrator_status() {
    local namespace="$1"

    log_info "Checking orchestrator status in namespace ${namespace}"

    # Check orchestrator components
    local components="sonataflow-platform-jobs-service sonataflow-platform-data-index-service"

    for component in $components; do
        if kubectl get deployment "$component" -n "${namespace}" &>/dev/null; then
            local ready
            ready=$(kubectl get deployment "$component" -n "${namespace}" -o jsonpath='{.status.readyReplicas}')
            if [[ "$ready" -ge 1 ]]; then
                log_success "$component is ready"
            else
                log_warning "$component is not ready"
            fi
        else
            log_debug "$component deployment not found (might not be required)"
        fi
    done
}

# ============================================================================
# SONATAFLOW DATABASE CONFIGURATION
# ============================================================================

configure_sonataflow_database() {
    local namespace="$1"
    local release_name="$2"

    log_info "Configuring SonataFlow database connection"

    # Wait for database creation job
    local job_name="${release_name}-create-sonataflow-database"
    local max_wait=60
    local count=0

    while [[ $count -lt $max_wait ]]; do
        if kubectl get job "${job_name}" -n "${namespace}" &>/dev/null; then
            log_info "Found database creation job, waiting for completion"
            kubectl wait --for=condition=complete job/"${job_name}" \
                -n "${namespace}" --timeout=3m
            break
        fi
        sleep 5
        count=$((count + 1))
    done

    # Patch SonataFlow platform for SSL connection
    if kubectl get sfp sonataflow-platform -n "${namespace}" &>/dev/null; then
        log_info "Patching SonataFlow platform for SSL"
        kubectl patch sfp sonataflow-platform -n "${namespace}" --type=merge \
            -p '{"spec":{"services":{"jobService":{"podTemplate":{"container":{"env":[{"name":"QUARKUS_DATASOURCE_REACTIVE_URL","value":"postgresql://postgress-external-db-primary.postgress-external-db.svc.cluster.local:5432/sonataflow?search_path=jobs-service&sslmode=require&ssl=true&trustAll=true"},{"name":"QUARKUS_DATASOURCE_REACTIVE_SSL_MODE","value":"require"},{"name":"QUARKUS_DATASOURCE_REACTIVE_TRUST_ALL","value":"true"}]}}}}}}'

        # Restart the deployment to apply changes
        kubectl rollout restart deployment/sonataflow-platform-jobs-service -n "${namespace}"
    fi
}

# Export functions
export -f install_orchestrator_infra_chart deploy_orchestrator_workflows
export -f verify_orchestrator_workflows check_orchestrator_status
export -f configure_sonataflow_database