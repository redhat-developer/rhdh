#!/usr/bin/env bash
#
# Environment Exporters - Centralize provider env exports for ConfigMaps/values
#

# Guard to prevent multiple sourcing
if [[ -n "${_ENV_EXPORTERS_LOADED:-}" ]]; then
    return 0
fi
readonly _ENV_EXPORTERS_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"

export_ocm_vars() {
    # Plain URL for pluginConfig in values files
    if [[ -z "${OCM_CLUSTER_URL_PLAIN:-}" && -n "${K8S_CLUSTER_URL:-}" ]]; then
        export OCM_CLUSTER_URL_PLAIN="${K8S_CLUSTER_URL}"
    fi
    # Base64 URL for Secrets (original behavior)
    if [[ -z "${OCM_CLUSTER_URL:-}" && -n "${K8S_CLUSTER_URL:-}" ]]; then
        export OCM_CLUSTER_URL=$(printf "%s" "${K8S_CLUSTER_URL}" | base64 | tr -d '\n')
    fi
    if [[ -z "${OCM_CLUSTER_TOKEN:-}" && -n "${K8S_CLUSTER_TOKEN_ENCODED:-}" ]]; then
        export OCM_CLUSTER_TOKEN="${K8S_CLUSTER_TOKEN_ENCODED}"
    fi
    if [[ -z "${OCM_SA_TOKEN:-}" && -n "${K8S_CLUSTER_TOKEN:-}" ]]; then
        export OCM_SA_TOKEN="${K8S_CLUSTER_TOKEN}"
    fi
    log_debug "OCM vars exported (CLUSTER_URL_PLAIN=${OCM_CLUSTER_URL_PLAIN})"
}

export_keycloak_vars() {
    # Ensure plain versions exist for ConfigMaps
    if [[ -n "${KEYCLOAK_AUTH_BASE_URL:-}" ]]; then
        export KEYCLOAK_AUTH_BASE_URL_PLAIN="${KEYCLOAK_AUTH_BASE_URL}"
    fi
    if [[ -n "${KEYCLOAK_AUTH_CLIENTID:-}" ]]; then
        export KEYCLOAK_AUTH_CLIENTID_PLAIN="${KEYCLOAK_AUTH_CLIENTID}"
    fi
    if [[ -n "${KEYCLOAK_AUTH_CLIENT_SECRET:-}" ]]; then
        export KEYCLOAK_AUTH_CLIENT_SECRET_PLAIN="${KEYCLOAK_AUTH_CLIENT_SECRET}"
    fi
    if [[ -n "${KEYCLOAK_AUTH_LOGIN_REALM:-}" ]]; then
        export KEYCLOAK_AUTH_LOGIN_REALM_PLAIN="${KEYCLOAK_AUTH_LOGIN_REALM}"
    fi
    if [[ -n "${KEYCLOAK_AUTH_REALM:-}" ]]; then
        export KEYCLOAK_AUTH_REALM_PLAIN="${KEYCLOAK_AUTH_REALM}"
    fi
    log_debug "Keycloak vars exported (BASE_URL=${KEYCLOAK_AUTH_BASE_URL_PLAIN})"
}

export_github_vars() {
    # Plain for ConfigMaps, encoded variants permanecem nos scripts legados
    if [[ -z "${GITHUB_URL_PLAIN:-}" ]]; then
        export GITHUB_URL_PLAIN="https://github.com"
    fi
    if [[ -z "${GITHUB_ORG_PLAIN:-}" ]]; then
        export GITHUB_ORG_PLAIN="janus-qe"
    fi
    log_debug "GitHub vars exported (URL=${GITHUB_URL_PLAIN}, ORG=${GITHUB_ORG_PLAIN})"
}

export_cloud_platform_vars() {
    # AKS specific variables
    if [[ -n "${AKS_CLUSTER_FQDN:-}" ]]; then
        export AKS_CLUSTER_FQDN_PLAIN="${AKS_CLUSTER_FQDN}"
    fi

    # Enable AKS Spot instances
    export ENABLE_AKS_SPOT="${ENABLE_AKS_SPOT:-false}"

    # EKS specific variables
    if [[ -n "${AWS_EKS_PARENT_DOMAIN:-}" ]]; then
        export EKS_INSTANCE_DOMAIN_NAME="${AWS_EKS_PARENT_DOMAIN}"
    fi

    # GKE specific variables
    if [[ -n "${GKE_INSTANCE_DOMAIN_NAME:-}" ]]; then
        export GKE_INSTANCE_DOMAIN_NAME_PLAIN="${GKE_INSTANCE_DOMAIN_NAME}"
    fi

    # GKE certificate name for managed certificates
    export GKE_CERT_NAME="${GKE_CERT_NAME:-rhdh-cert}"

    log_debug "Cloud platform vars exported (AKS_SPOT=${ENABLE_AKS_SPOT}, GKE_CERT=${GKE_CERT_NAME})"
}

export_upgrade_vars() {
    # Variables for upgrade testing
    export ENABLE_UPGRADE_TESTS="${ENABLE_UPGRADE_TESTS:-false}"
    export UPGRADE_FROM_VERSION="${UPGRADE_FROM_VERSION:-}"
    export UPGRADE_TO_VERSION="${UPGRADE_TO_VERSION:-}"

    log_debug "Upgrade vars exported (ENABLED=${ENABLE_UPGRADE_TESTS})"
}

export_default_providers_env() {
    export_ocm_vars
    export_keycloak_vars
    export_github_vars
    export_cloud_platform_vars
    export_upgrade_vars
}

# Export functions
export -f export_ocm_vars export_keycloak_vars export_github_vars export_default_providers_env
export -f export_cloud_platform_vars export_upgrade_vars


