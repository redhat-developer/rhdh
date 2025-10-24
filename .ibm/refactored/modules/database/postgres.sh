#!/usr/bin/env bash
# PostgreSQL Database Configuration Module
#
# This module handles PostgreSQL database setup for RHDH deployments,
# including certificate management and credential configuration.

# Guard to prevent multiple sourcing
if [[ -n "${_POSTGRES_LOADED:-}" ]]; then
    return 0
fi
readonly _POSTGRES_LOADED=true

set -euo pipefail

# Source dependencies
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${DIR}/modules/logging.sh"
source "${DIR}/modules/k8s-operations.sh"

# Install Crunchy PostgreSQL Operator for OpenShift
# This operator is required to manage PostgreSQL clusters
install_crunchy_postgres_operator() {
    log_info "Installing Crunchy PostgreSQL Operator"
    
    # Check if operator is already installed
    if resource_exists "deployment" "pgo" "postgres-operator"; then
        log_info "Crunchy PostgreSQL Operator already installed"
        return 0
    fi
    
    # Create namespace for postgres operator
    kubectl create namespace postgres-operator --dry-run=client -o yaml | kubectl apply -f -
    
    # Install operator subscription
    log_info "Creating operator subscription"
    kubectl apply -f - <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: postgres-operator
  namespace: postgres-operator
spec:
  # No targetNamespaces = AllNamespaces mode (watches all namespaces)
  # This allows PostgresCluster to be created in any namespace
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: postgresql
  namespace: postgres-operator
spec:
  channel: v5
  installPlanApproval: Automatic
  name: postgresql
  source: community-operators
  sourceNamespace: openshift-marketplace
EOF
    
    # Wait for operator to be ready
    log_info "Waiting for Crunchy PostgreSQL Operator to be ready..."
    local max_wait=300
    local waited=0
    local check_interval=10
    
    while ! resource_exists "deployment" "pgo" "postgres-operator"; do
        if [[ ${waited} -ge ${max_wait} ]]; then
            log_error "Timeout waiting for PostgreSQL operator after ${max_wait}s"
            log_info "Checking operator subscription status:"
            kubectl get subscription postgresql -n postgres-operator -o yaml 2>/dev/null || true
            kubectl get csv -n postgres-operator 2>/dev/null || true
            return 1
        fi
        sleep ${check_interval}
        waited=$((waited + check_interval))
        log_debug "Waiting for operator deployment... (${waited}s/${max_wait}s)"
    done
    
    # Wait for deployment to be ready
    wait_for_deployment "postgres-operator" "pgo" 300
    
    log_success "Crunchy Postgres operator installed"
}

# Configure external PostgreSQL database for a target namespace
# This function:
# 1. Deploys PostgreSQL to the dedicated postgres namespace
# 2. Copies TLS certificates from postgres namespace to target namespace
# 3. Configures database credentials
#
# Args:
#   $1 - target_namespace: Namespace where RHDH will run
#   $2 - postgres_namespace: Namespace where PostgreSQL runs
configure_external_postgres_db() {
    local target_namespace="${1}"
    local postgres_namespace="${2}"

    log_info "Configuring external PostgreSQL database"
    log_debug "Target namespace: ${target_namespace}"
    log_debug "PostgreSQL namespace: ${postgres_namespace}"

    # Deploy PostgreSQL operator instance
    local postgres_yaml="${DIR}/resources/postgres-db/postgres.yaml"
    if [[ ! -f "${postgres_yaml}" ]]; then
        log_error "PostgreSQL manifest not found: ${postgres_yaml}"
        return 1
    fi

    log_info "Deploying PostgreSQL to namespace: ${postgres_namespace}"
    oc apply -f "${postgres_yaml}" --namespace="${postgres_namespace}"

    # Wait for PostgreSQL TLS secret to be created by the operator
    log_info "Waiting for PostgreSQL TLS secret to be created (this may take 2-3 minutes)..."
    local max_wait=300  # 5 minutes
    local waited=0
    local check_interval=15
    
    while ! oc get secret postgress-external-db-cluster-cert -n "${postgres_namespace}" &>/dev/null; do
        if [[ ${waited} -ge ${max_wait} ]]; then
            log_error "Timeout waiting for PostgreSQL secret after ${max_wait}s"
            log_info "Debugging information:"
            log_info "PostgresCluster status:"
            oc get postgrescluster -n "${postgres_namespace}" -o yaml 2>/dev/null || true
            log_info "Pods in ${postgres_namespace}:"
            oc get pods -n "${postgres_namespace}" 2>/dev/null || true
            log_info "Secrets in ${postgres_namespace}:"
            oc get secrets -n "${postgres_namespace}" 2>/dev/null || true
            log_info "Events in ${postgres_namespace}:"
            oc get events -n "${postgres_namespace}" --sort-by='.lastTimestamp' | tail -20 || true
            return 1
        fi
        sleep ${check_interval}
        waited=$((waited + check_interval))
        log_info "Waiting for PostgreSQL secret... (${waited}s/${max_wait}s)"
    done

    log_success "PostgreSQL TLS secret found after ${waited}s"

    # Create temporary directory for certificates
    local temp_cert_dir
    temp_cert_dir=$(mktemp -d)
    trap "rm -rf ${temp_cert_dir}" EXIT

    # Extract certificates from PostgreSQL namespace
    oc get secret postgress-external-db-cluster-cert \
        -n "${postgres_namespace}" \
        -o jsonpath='{.data.ca\.crt}' | base64 --decode > "${temp_cert_dir}/postgres-ca"

    oc get secret postgress-external-db-cluster-cert \
        -n "${postgres_namespace}" \
        -o jsonpath='{.data.tls\.crt}' | base64 --decode > "${temp_cert_dir}/postgres-tls-crt"

    oc get secret postgress-external-db-cluster-cert \
        -n "${postgres_namespace}" \
        -o jsonpath='{.data.tls\.key}' | base64 --decode > "${temp_cert_dir}/postgres-tsl-key"

    log_info "Certificates extracted successfully"

    # Create secret in target namespace
    log_info "Creating PostgreSQL TLS secret in target namespace: ${target_namespace}"
    oc create secret generic postgress-external-db-cluster-cert \
        --from-file=ca.crt="${temp_cert_dir}/postgres-ca" \
        --from-file=tls.crt="${temp_cert_dir}/postgres-tls-crt" \
        --from-file=tls.key="${temp_cert_dir}/postgres-tsl-key" \
        --dry-run=client -o yaml | oc apply -f - --namespace="${target_namespace}"

    log_info "PostgreSQL TLS secret created successfully"

    # Configure PostgreSQL credentials
    configure_postgres_credentials "${target_namespace}" "${postgres_namespace}"

    log_info "External PostgreSQL database configured successfully"
}

# Configure PostgreSQL credentials for RHDH
# Creates a secret with database connection details
#
# Args:
#   $1 - target_namespace: Namespace where RHDH will run
#   $2 - postgres_namespace: Namespace where PostgreSQL runs
configure_postgres_credentials() {
    local target_namespace="${1}"
    local postgres_namespace="${2}"

    log_info "Configuring PostgreSQL credentials"

    local postgres_cred_yaml="${DIR}/resources/postgres-db/postgres-cred.yaml"
    if [[ ! -f "${postgres_cred_yaml}" ]]; then
        log_error "PostgreSQL credentials template not found: ${postgres_cred_yaml}"
        return 1
    fi

    # Extract PostgreSQL password
    local postgres_password
    postgres_password=$(oc get secret/postgress-external-db-pguser-janus-idp \
        -n "${postgres_namespace}" \
        -o jsonpath='{.data.password}')

    # Calculate PostgreSQL host (internal cluster DNS)
    local postgres_host
    postgres_host=$(echo -n "postgress-external-db-primary.${postgres_namespace}.svc.cluster.local" | base64 | tr -d '\n')

    log_debug "PostgreSQL host: ${postgres_host}"

    # Create temporary file with substituted values
    local temp_cred_file
    temp_cred_file=$(mktemp)
    trap "rm -f ${temp_cred_file}" EXIT

    # Use sed to substitute values in the template
    # Use gsed on macOS, sed on Linux
    local sed_cmd="sed"
    if command -v gsed &> /dev/null; then
        sed_cmd="gsed"
    fi
    
    ${sed_cmd} -e "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${postgres_password}|g" \
        -e "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${postgres_host}|g" \
        "${postgres_cred_yaml}" > "${temp_cred_file}"

    # Apply credentials to target namespace
    oc apply -f "${temp_cred_file}" --namespace="${target_namespace}"

    log_info "PostgreSQL credentials configured successfully"
}

# Cleanup PostgreSQL resources
# Removes PostgreSQL instance and related secrets
#
# Args:
#   $1 - postgres_namespace: Namespace where PostgreSQL runs
cleanup_postgres_db() {
    local postgres_namespace="${1}"

    log_info "Cleaning up PostgreSQL resources from namespace: ${postgres_namespace}"

    # Delete PostgreSQL instance
    local postgres_yaml="${DIR}/resources/postgres-db/postgres.yaml"
    if [[ -f "${postgres_yaml}" ]]; then
        oc delete -f "${postgres_yaml}" --namespace="${postgres_namespace}" --ignore-not-found=true
    fi

    # Delete PostgreSQL secrets
    oc delete secret postgress-external-db-cluster-cert \
        --namespace="${postgres_namespace}" \
        --ignore-not-found=true

    log_info "PostgreSQL cleanup completed"
}

# Check if PostgreSQL is ready
# Verifies that PostgreSQL pod is running and ready
#
# Args:
#   $1 - postgres_namespace: Namespace where PostgreSQL runs
# Returns:
#   0 if ready, 1 if not ready
is_postgres_ready() {
    local postgres_namespace="${1}"

    if ! oc get pods -n "${postgres_namespace}" -l postgres-operator.crunchydata.com/cluster=postgress-external-db -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q "Running"; then
        return 1
    fi

    return 0
}

# Wait for PostgreSQL to be ready
# Polls PostgreSQL status until ready or timeout
#
# Args:
#   $1 - postgres_namespace: Namespace where PostgreSQL runs
#   $2 - timeout_seconds: Maximum time to wait (default: 300)
wait_for_postgres_ready() {
    local postgres_namespace="${1}"
    local timeout_seconds="${2:-300}"

    log_info "Waiting for PostgreSQL to be ready (timeout: ${timeout_seconds}s)..."

    local elapsed=0
    while ! is_postgres_ready "${postgres_namespace}"; do
        if [[ ${elapsed} -ge ${timeout_seconds} ]]; then
            log_error "Timeout waiting for PostgreSQL to be ready"
            return 1
        fi
        sleep 10
        elapsed=$((elapsed + 10))
        log_debug "Waited ${elapsed}s for PostgreSQL..."
    done

    log_info "PostgreSQL is ready"
    return 0
}

# Export functions
export -f install_crunchy_postgres_operator
export -f configure_external_postgres_db
export -f configure_postgres_credentials
export -f cleanup_postgres_db
export -f is_postgres_ready
export -f wait_for_postgres_ready

