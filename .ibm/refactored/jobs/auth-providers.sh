#!/usr/bin/env bash
#
# Auth Providers Job - Test RHDH with various authentication providers
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# Load operator module
source "${DIR}/modules/operator.sh"

# ============================================================================
# JOB CONFIGURATION
# ============================================================================

# Namespace and release configuration
readonly AUTH_PROVIDERS_NAMESPACE="${AUTH_PROVIDERS_NAMESPACE:-showcase-auth-providers}"
readonly AUTH_PROVIDERS_RELEASE="${AUTH_PROVIDERS_RELEASE:-rhdh-auth-providers}"
readonly AUTH_PROVIDERS_VALUE_FILE="${HELM_CHART_VALUE_FILE_NAME:-values_showcase-auth-providers.yaml}"

# Logs folder
readonly LOGS_FOLDER="${LOGS_FOLDER:-$(pwd)/e2e-tests/auth-providers-logs}"

# ============================================================================
# AUTH PROVIDERS SPECIFIC FUNCTIONS
# ============================================================================

setup_auth_providers_secrets() {
    log_section "Setting up authentication providers secrets"

    # Create namespace
    create_namespace_if_not_exists "${AUTH_PROVIDERS_NAMESPACE}"

    # Create secrets for various auth providers
    local secrets_file="/tmp/auth-providers-secrets.yaml"

    cat > "${secrets_file}" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: auth-providers-secrets
  namespace: ${AUTH_PROVIDERS_NAMESPACE}
type: Opaque
stringData:
  # Azure/Microsoft Auth
  AUTH_PROVIDERS_AZURE_CLIENT_ID: "${AUTH_PROVIDERS_AZURE_CLIENT_ID}"
  AUTH_PROVIDERS_AZURE_CLIENT_SECRET: "${AUTH_PROVIDERS_AZURE_CLIENT_SECRET}"
  AUTH_PROVIDERS_AZURE_TENANT_ID: "${AUTH_PROVIDERS_AZURE_TENANT_ID}"

  # GitHub Auth
  AUTH_ORG_CLIENT_ID: "${AUTH_PROVIDERS_GH_ORG_CLIENT_ID}"
  AUTH_ORG_CLIENT_SECRET: "${AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET}"
  AUTH_PROVIDERS_GH_ORG_NAME: "${AUTH_PROVIDERS_GH_ORG_NAME}"

  # Keycloak/RHSSO Auth
  RHSSO76_URL: "${RHBK_BASE_URL}"
  RHSSO76_METADATA_URL: "${RHBK_BASE_URL}/realms/${RHBK_REALM}/.well-known/openid-configuration"
  RHSSO76_CLIENT_ID: "${RHBK_CLIENT_ID}"
  RHSSO76_CLIENT_SECRET: "${RHBK_CLIENT_SECRET}"
  AUTH_PROVIDERS_REALM_NAME: "${RHBK_REALM}"

  # LDAP Auth (if configured)
  RHBK_LDAP_REALM: "${RHBK_LDAP_REALM:-}"
  RHBK_LDAP_CLIENT_ID: "${RHBK_LDAP_CLIENT_ID:-}"
  RHBK_LDAP_CLIENT_SECRET: "${RHBK_LDAP_CLIENT_SECRET:-}"
  RHBK_LDAP_USER_BIND: "${RHBK_LDAP_USER_BIND:-}"
  RHBK_LDAP_USER_PASSWORD: "${RHBK_LDAP_USER_PASSWORD:-}"
  RHBK_LDAP_TARGET: "${RHBK_LDAP_TARGET:-}"

  # Default users
  DEFAULT_USER_PASSWORD: "${DEFAULT_USER_PASSWORD}"
  DEFAULT_USER_PASSWORD_2: "${DEFAULT_USER_PASSWORD_2}"
EOF

    kubectl apply -f "${secrets_file}"
    rm -f "${secrets_file}"

    log_success "Authentication providers secrets configured"
}

deploy_auth_providers() {
    log_section "Deploying RHDH with authentication providers"

    # Get cluster router base
    local router_base="${K8S_CLUSTER_ROUTER_BASE}"
    if [[ -z "${router_base}" ]]; then
        if [[ "${IS_OPENSHIFT}" == "true" ]]; then
            router_base=$(get_ocp_cluster_router_base)
        else
            router_base=$(get_k8s_cluster_router_base)
        fi
    fi
    export K8S_CLUSTER_ROUTER_BASE="${router_base}"

    # Setup authentication providers secrets
    setup_auth_providers_secrets

    # Deploy Redis cache
    deploy_redis_cache "${AUTH_PROVIDERS_NAMESPACE}"

    # Apply auth providers specific configuration
    local app_config="${DIR}/resources/config_map/app-config-auth-providers.yaml"
    if [[ -f "${app_config}" ]]; then
        log_info "Applying auth providers app config"
        kubectl apply -f "${app_config}" -n "${AUTH_PROVIDERS_NAMESPACE}"
    else
        log_warning "Auth providers app config not found, creating default"
        create_auth_providers_app_config
    fi

    # Deploy RBAC policies for auth testing
    deploy_auth_providers_rbac_policies

    # Helm chart preflight (render + client validate)
    local expected_hostname="redhat-developer-hub-${AUTH_PROVIDERS_NAMESPACE}.${K8S_CLUSTER_ROUTER_BASE}"
    if ! helm_preflight_validate "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}" "${DIR}/value_files/${AUTH_PROVIDERS_VALUE_FILE}" "${expected_hostname}"; then
        log_error "Preflight validation failed for Helm manifests (auth-providers). Aborting deploy."
        return 1
    fi

    # Deploy with Helm
    local rhdh_base_url="https://${expected_hostname}"

    log_info "Deploying with Helm"
    helm_install_rhdh \
        "${AUTH_PROVIDERS_RELEASE}" \
        "${AUTH_PROVIDERS_NAMESPACE}" \
        "${DIR}/value_files/${AUTH_PROVIDERS_VALUE_FILE}" \
        "${expected_hostname}"

    # Wait for deployment to be ready
    wait_for_deployment "${AUTH_PROVIDERS_NAMESPACE}" "redhat-developer-hub-${AUTH_PROVIDERS_RELEASE}"

    log_success "Auth providers deployment ready at: ${rhdh_base_url}"
}

create_auth_providers_app_config() {
    log_info "Creating auth providers app config"

    cat <<EOF | kubectl apply -n "${AUTH_PROVIDERS_NAMESPACE}" -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-auth-providers
  namespace: ${AUTH_PROVIDERS_NAMESPACE}
data:
  app-config-auth-providers.yaml: |
    app:
      title: Red Hat Developer Hub - Auth Providers Test
      baseUrl: https://redhat-developer-hub-${AUTH_PROVIDERS_NAMESPACE}.\${K8S_CLUSTER_ROUTER_BASE}

    backend:
      baseUrl: https://redhat-developer-hub-${AUTH_PROVIDERS_NAMESPACE}.\${K8S_CLUSTER_ROUTER_BASE}
      cors:
        origin: https://redhat-developer-hub-${AUTH_PROVIDERS_NAMESPACE}.\${K8S_CLUSTER_ROUTER_BASE}

      auth:
        keys:
          - secret: \${BACKEND_SECRET}
EOF
}

deploy_auth_providers_rbac_policies() {
    log_info "Deploying RBAC policies for auth providers testing"

    cat <<EOF | kubectl apply -n "${AUTH_PROVIDERS_NAMESPACE}" -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: rbac-policy
  namespace: ${AUTH_PROVIDERS_NAMESPACE}
data:
  rbac-policy.csv: |
    # Basic roles for auth testing
    p, role:default/guest, catalog-entity, read, allow
    p, role:default/viewer, catalog-entity, read, allow
    p, role:default/editor, catalog-entity, *, allow

    # GitHub org specific
    g, github.com/${AUTH_PROVIDERS_GH_ORG_NAME}, role:default/viewer

    # Azure AD groups
    g, AzureAD:rhdh_test_group_viewer, role:default/viewer
    g, AzureAD:rhdh_test_group_editor, role:default/editor

    # Keycloak/RHSSO groups
    g, keycloak:viewer-group, role:default/viewer
    g, keycloak:editor-group, role:default/editor
EOF
}

run_auth_providers_tests() {
    log_section "Running authentication providers tests"

    # Create logs folder
    mkdir -p "${LOGS_FOLDER}"

    # Export test configuration
    export TEST_NAMESPACE="${AUTH_PROVIDERS_NAMESPACE}"
    export TEST_RELEASE="${AUTH_PROVIDERS_RELEASE}"
    export TEST_URL="https://redhat-developer-hub-${AUTH_PROVIDERS_NAMESPACE}.${K8S_CLUSTER_ROUTER_BASE}"

    # Check if E2E tests are available
    if [[ -d "${DIR}/../e2e-tests/auth-providers" ]]; then
        log_info "Running E2E tests for auth providers"

        cd "${DIR}/../e2e-tests/auth-providers"

        # Install dependencies if needed
        if [[ -f "package.json" ]]; then
            npm install
        fi

        # Run tests for each provider
        for provider in github azure keycloak oidc; do
            log_info "Testing ${provider} authentication"
            npm test -- --auth-provider="${provider}" || {
                log_error "Tests failed for ${provider}"
                collect_logs "${AUTH_PROVIDERS_NAMESPACE}" "${LOGS_FOLDER}/${provider}"
            }
        done
    else
        log_warning "E2E tests not found, running basic health checks"
        run_basic_auth_tests
    fi
}

run_basic_auth_tests() {
    log_info "Running basic authentication tests"

    local base_url="https://redhat-developer-hub-${AUTH_PROVIDERS_NAMESPACE}.${K8S_CLUSTER_ROUTER_BASE}"

    # Test health endpoint
    if curl -sSf "${base_url}/api/health" > /dev/null 2>&1; then
        log_success "Health check passed"
    else
        log_error "Health check failed"
        return 1
    fi

    # Test auth endpoints
    local auth_providers=("github" "microsoft" "oidc")
    for provider in "${auth_providers[@]}"; do
        log_info "Testing ${provider} auth endpoint"

        local response
        response=$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/api/auth/${provider}/start" 2>/dev/null || echo "000")

        if [[ "${response}" == "302" ]] || [[ "${response}" == "303" ]]; then
            log_success "${provider} auth endpoint is redirecting correctly"
        else
            log_warning "${provider} auth endpoint returned: ${response}"
        fi
    done
}

cleanup_auth_providers() {
    log_section "Cleaning up auth providers deployment"

    # Uninstall Helm release
    uninstall_helmchart "${AUTH_PROVIDERS_NAMESPACE}" "${AUTH_PROVIDERS_RELEASE}"

    # Delete namespace
    delete_namespace "${AUTH_PROVIDERS_NAMESPACE}"

    log_success "Auth providers cleanup completed"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_header "Authentication Providers Test Job"

    # Setup operator if needed
    if [[ "${USE_OPERATOR:-false}" == "true" ]]; then
        log_info "Setting up operator for auth providers"

        # Platform detection
        detect_platform

        # Setup operator based on platform
        if [[ "${IS_OPENSHIFT}" == "true" ]]; then
            cluster_setup_ocp_operator
        else
            cluster_setup_k8s_operator
        fi

        prepare_operator "3"
    fi

    # Deploy RHDH with auth providers
    deploy_auth_providers

    # Run tests
    run_auth_providers_tests

    # Cleanup if not skipped
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_auth_providers
    fi

    log_success "Authentication providers test job completed"
}

# Execute main function
main "$@"