#!/usr/bin/env bash
#
# RBAC Deployment Module - RHDH with RBAC and external PostgreSQL
#

# Guard to prevent multiple sourcing
if [[ -n "${_RBAC_DEPLOYMENT_LOADED:-}" ]]; then
    return 0
fi
readonly _RBAC_DEPLOYMENT_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../k8s-operations.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../orchestrator.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../database/postgres.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../constants.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../retry.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../platform/detection.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../helm.sh"

rbac_deployment() {
    local namespace="${NAME_SPACE_RBAC}"
    local release_name="${RELEASE_NAME_RBAC}"
    local postgres_namespace="${NAME_SPACE_POSTGRES_DB}"

    log_info "Starting RBAC deployment: ${release_name} in ${namespace}"

    # Configure namespaces
    configure_namespace "${postgres_namespace}"
    configure_namespace "${namespace}"

    # Setup external PostgreSQL
    # Copy TLS certificates from postgres namespace to RBAC namespace
    if [[ "${USE_EXTERNAL_POSTGRES:-true}" == "true" ]]; then
        log_info "Configuring external PostgreSQL for RBAC deployment"
        configure_external_postgres_db "${namespace}" "${postgres_namespace}"
    fi

    # Apply configuration files
    # With fullnameOverride, the service/route will be 'redhat-developer-hub'
    local rbac_rhdh_base_url="https://redhat-developer-hub-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
    apply_yaml_files "${DIR}" "${namespace}" "${rbac_rhdh_base_url}"

    log_info "Deploying RBAC RHDH from: ${QUAY_REPO} with tag: ${TAG_NAME}"

    # Select appropriate value file (with or without orchestrator plugins)
    local value_file=$(select_deployment_value_file "${HELM_CHART_RBAC_VALUE_FILE_NAME}" "values_showcase-rbac_nightly.yaml")

    # Calculate hostname and export BASE_URL variables for CORS/secrets
    local expected_hostname=$(calculate_and_export_base_url "${namespace}")

    # Preflight validation to catch YAML/JSON conversion errors early
    if ! helm_preflight_validate "${release_name}" "${namespace}" "${value_file}" "${expected_hostname}"; then
        log_error "Preflight validation failed for Helm manifests. Aborting deploy."
        return 1
    fi

    # Perform Helm installation with calculated values
    if helm_install_rhdh "${release_name}" "${namespace}" "${value_file}" "${expected_hostname}"; then
        log_success "RBAC deployment completed successfully"
    else
        log_error "RBAC deployment failed"
        return 1
    fi

    # Configure SonataFlow database connection (only when orchestrator enabled)
    if [[ "${DEPLOY_ORCHESTRATOR:-false}" == "true" ]]; then
        configure_sonataflow_database "${namespace}" "${release_name}"
        deploy_orchestrator_workflows "${namespace}"
    fi
}



# Export functions
export -f rbac_deployment