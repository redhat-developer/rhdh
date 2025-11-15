#!/bin/bash
# Core environment variables for RHDH CI/CD Pipeline
# shellcheck disable=SC2034,SC2155
# SC2034: Allow unused variables (exported for child processes)
# SC2155: Allow export with command substitution (intentional for secret loading)

# Prevent double sourcing
if [[ -n "${__CORE_ENV_SH_LOADED__:-}" ]]; then
  return 0
fi
export __CORE_ENV_SH_LOADED__=1

set -euo pipefail  # Exit on error, undefined variables, and pipe failures
set -a             # Automatically export all variables

# ============================================================================
# Pipeline Root Directory Detection
# ============================================================================
# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Pipeline root is one level up from core/
PIPELINES_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PIPELINES_ROOT
# Project root (where pipelines/ is located)
PROJECT_ROOT="$(cd "${PIPELINES_ROOT}/.." && pwd)"
export PROJECT_ROOT

# ============================================================================
# Environment Detection
# ============================================================================
# Detect if running in OpenShift CI or locally
export OPENSHIFT_CI="${OPENSHIFT_CI:-false}"
export ISRUNNINGLOCAL="${ISRUNNINGLOCAL:-true}"
export ISRUNNINGLOCALDEBUG="${ISRUNNINGLOCALDEBUG:-false}"

# ============================================================================
# CI Job Information
# ============================================================================
# Job metadata populated by OpenShift CI
# https://docs.ci.openshift.org/docs/architecture/step-registry/#available-environment-variables
# https://docs.prow.k8s.io/docs/jobs/#job-environment-variables
export JOB_NAME="${JOB_NAME:-unknown-job}"
export TAG_NAME="${TAG_NAME:-latest}"
export BUILD_ID="${BUILD_ID:-unknown-build}"
export PULL_NUMBER="${PULL_NUMBER:-}"
export REPO_OWNER="${REPO_OWNER:-redhat-developer}"
export REPO_NAME="${REPO_NAME:-rhdh}"
export RELEASE_BRANCH_NAME="${RELEASE_BRANCH_NAME:-main}"

# ============================================================================
# Directory Structure
# ============================================================================
# Working directories for CI artifacts and temporary files
export SHARED_DIR="${SHARED_DIR:-${PIPELINES_ROOT}/shared_dir}"
export ARTIFACT_DIR="${ARTIFACT_DIR:-${PIPELINES_ROOT}/artifact_dir}"
mkdir -p "${SHARED_DIR}"
mkdir -p "${ARTIFACT_DIR}"

# ============================================================================
# Logging Configuration
# ============================================================================
export LOGFILE="test-log"
export JUNIT_RESULTS="junit-results.xml"

# ============================================================================
# Cluster Configuration
# ============================================================================
# Kubernetes/OpenShift cluster connection details
export K8S_CLUSTER_TOKEN="${K8S_CLUSTER_TOKEN:-}"
export K8S_CLUSTER_URL="${K8S_CLUSTER_URL:-}"
export K8S_CLUSTER_ROUTER_BASE="${K8S_CLUSTER_ROUTER_BASE:-}"

# Encoded values for ConfigMaps and secrets
if [[ -n "${K8S_CLUSTER_TOKEN}" ]]; then
  export K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" "$K8S_CLUSTER_TOKEN" | base64 | tr -d '\n')
  export K8S_SERVICE_ACCOUNT_TOKEN="${K8S_CLUSTER_TOKEN_ENCODED}"
fi

if [[ -n "${K8S_CLUSTER_URL}" ]]; then
  # Base64 encoded URL for Kubernetes and OCM plugins (decoded by the plugins)
  export K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export OCM_CLUSTER_URL="${K8S_CLUSTER_API_SERVER_URL}"
  export OCM_CLUSTER_TOKEN="${K8S_CLUSTER_TOKEN_ENCODED}"
fi

export ENCODED_CLUSTER_NAME=$(echo "my-cluster" | base64)

# ============================================================================
# Platform Detection
# ============================================================================
export IS_OPENSHIFT="${IS_OPENSHIFT:-true}"
export CONTAINER_PLATFORM="${CONTAINER_PLATFORM:-unknown}"
export CONTAINER_PLATFORM_VERSION="${CONTAINER_PLATFORM_VERSION:-unknown}"

# ============================================================================
# Helm Configuration
# ============================================================================
export HELM_CHART_URL="oci://quay.io/rhdh/chart"
export CHART_MAJOR_VERSION="1.9"

# Helm value file names
export HELM_CHART_VALUE_FILE_NAME="showcase.yaml"
export HELM_CHART_RBAC_VALUE_FILE_NAME="showcase-rbac.yaml"

# ============================================================================
# Container Registry Configuration
# ============================================================================
export QUAY_REPO="${QUAY_REPO:-rhdh-community/rhdh}"

# ============================================================================
# Namespace Configuration
# ============================================================================
# Default namespaces for deployments
export RELEASE_NAME="rhdh"
export RELEASE_NAME_RBAC="rhdh-rbac"
export NAME_SPACE="${NAME_SPACE:-showcase}"
export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

# ============================================================================
# Secrets Management
# ============================================================================
# Load secrets from vault if running in CI
# In local development, these should be provided via env_override.local.sh

load_secret() {
  local secret_name=$1
  local secret_file="/tmp/secrets/${secret_name}"
  
  if [[ -f "${secret_file}" ]]; then
    cat "${secret_file}"
  else
    echo ""
  fi
}

# Quay registry secrets
export QUAY_NAMESPACE=$(load_secret "QUAY_NAMESPACE")
export QUAY_TOKEN=$(load_secret "QUAY_TOKEN")

# GitHub App configuration for integrations
export GITHUB_APP_APP_ID=$(load_secret "GITHUB_APP_3_APP_ID")
export GITHUB_APP_CLIENT_ID=$(load_secret "GITHUB_APP_3_CLIENT_ID")
export GITHUB_APP_PRIVATE_KEY=$(load_secret "GITHUB_APP_3_PRIVATE_KEY")
export GITHUB_APP_CLIENT_SECRET=$(load_secret "GITHUB_APP_3_CLIENT_SECRET")
export GITHUB_APP_WEBHOOK_SECRET=$(load_secret "GITHUB_APP_WEBHOOK_SECRET")

# GitHub App JANUS TEST (second app)
export GITHUB_APP_JANUS_TEST_APP_ID=$(load_secret "GITHUB_APP_JANUS_TEST_APP_ID")
export GITHUB_APP_JANUS_TEST_CLIENT_ID=$(load_secret "GITHUB_APP_JANUS_TEST_CLIENT_ID")
export GITHUB_APP_JANUS_TEST_PRIVATE_KEY=$(load_secret "GITHUB_APP_JANUS_TEST_PRIVATE_KEY")
export GITHUB_APP_JANUS_TEST_CLIENT_SECRET=$(load_secret "GITHUB_APP_JANUS_TEST_CLIENT_SECRET")

# Hardcoded values (base64 encoded)
export GITHUB_APP_WEBHOOK_URL="aHR0cHM6Ly9zbWVlLmlvL0NrRUNLYVgwNzhyZVhobEpEVzA="
export GITHUB_URL="aHR0cHM6Ly9naXRodWIuY29t"
export GITHUB_ORG="amFudXMtcWU="
export GITHUB_ORG_2="amFudXMtdGVzdA=="

# Test users
export GH_USER_ID=$(load_secret "GH_USER_ID")
export GH_USER_PASS=$(load_secret "GH_USER_PASS")
export GH_2FA_SECRET=$(load_secret "GH_2FA_SECRET")
export GH_USER2_ID=$(load_secret "GH_USER2_ID")
export GH_USER2_PASS=$(load_secret "GH_USER2_PASS")
export GH_USER2_2FA_SECRET=$(load_secret "GH_USER2_2FA_SECRET")
export GH_RHDH_QE_USER_TOKEN=$(load_secret "GH_RHDH_QE_USER_TOKEN")

# Additional test users
export QE_USER3_ID=$(load_secret "QE_USER3_ID")
export QE_USER3_PASS=$(load_secret "QE_USER3_PASS")
export QE_USER4_ID=$(load_secret "QE_USER4_ID")
export QE_USER4_PASS=$(load_secret "QE_USER4_PASS")
export QE_USER5_ID=$(load_secret "QE_USER5_ID")
export QE_USER5_PASS=$(load_secret "QE_USER5_PASS")
export QE_USER6_ID=$(load_secret "QE_USER6_ID")
export QE_USER6_PASS=$(load_secret "QE_USER6_PASS")

# GitLab integration
export GITLAB_TOKEN=$(load_secret "GITLAB_TOKEN")

# Google OAuth and services
export GOOGLE_CLIENT_ID=$(load_secret "GOOGLE_CLIENT_ID")
export GOOGLE_CLIENT_SECRET=$(load_secret "GOOGLE_CLIENT_SECRET")
export GOOGLE_ACC_COOKIE=$(load_secret "GOOGLE_ACC_COOKIE")
export GOOGLE_USER_ID=$(load_secret "GOOGLE_USER_ID")
export GOOGLE_USER_PASS=$(load_secret "GOOGLE_USER_PASS")
export GOOGLE_2FA_SECRET=$(load_secret "GOOGLE_2FA_SECRET")
export GOOGLE_CLOUD_PROJECT=$(load_secret "GOOGLE_CLOUD_PROJECT")

# Keycloak authentication provider
export KEYCLOAK_BASE_URL=$(load_secret "KEYCLOAK_BASE_URL")
export KEYCLOAK_LOGIN_REALM="myrealm"
export KEYCLOAK_REALM="myrealm"
export KEYCLOAK_CLIENT_ID="myclient"
export KEYCLOAK_CLIENT_SECRET=$(load_secret "KEYCLOAK_CLIENT_SECRET")

# Encoded Keycloak values for secrets
if [[ -n "${KEYCLOAK_BASE_URL}" ]]; then
  export KEYCLOAK_BASE_URL_ENCODED=$(printf "%s" "$KEYCLOAK_BASE_URL" | base64 | tr -d '\n')
fi
if [[ -n "${KEYCLOAK_LOGIN_REALM}" ]]; then
  export KEYCLOAK_LOGIN_REALM_ENCODED=$(printf "%s" "$KEYCLOAK_LOGIN_REALM" | base64 | tr -d '\n')
fi
if [[ -n "${KEYCLOAK_REALM}" ]]; then
  export KEYCLOAK_REALM_ENCODED=$(printf "%s" "$KEYCLOAK_REALM" | base64 | tr -d '\n')
fi
if [[ -n "${KEYCLOAK_CLIENT_ID}" ]]; then
  export KEYCLOAK_CLIENT_ID_ENCODED=$(printf "%s" "$KEYCLOAK_CLIENT_ID" | base64 | tr -d '\n')
fi
if [[ -n "${KEYCLOAK_CLIENT_SECRET}" ]]; then
  export KEYCLOAK_CLIENT_SECRET_ENCODED=$(printf "%s" "$KEYCLOAK_CLIENT_SECRET" | base64 | tr -d '\n')
fi

# Redis cache credentials
export REDIS_USERNAME="temp"
export REDIS_PASSWORD="test123"
export REDIS_USERNAME_ENCODED=$(printf "%s" "$REDIS_USERNAME" | base64 | tr -d '\n')
export REDIS_PASSWORD_ENCODED=$(printf "%s" "$REDIS_PASSWORD" | base64 | tr -d '\n')

# PostgreSQL RDS configuration
export RDS_USER='cmhkaHFl'
export RDS_PASSWORD=$(load_secret "RDS_PASSWORD")

# Container registry pull secret
export REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON=$(load_secret "REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON")

# Backend secret for authentication
export BACKEND_SECRET=$(printf "temp" | base64 | tr -d '\n')

# Slack webhook for notifications
export SLACK_DATA_ROUTER_WEBHOOK_URL=$(load_secret "SLACK_DATA_ROUTER_WEBHOOK_URL")

# GitHub OAuth App
export GITHUB_OAUTH_APP_ID=$(load_secret "GITHUB_OAUTH_APP_ID")
export GITHUB_OAUTH_APP_SECRET=$(load_secret "GITHUB_OAUTH_APP_SECRET")
if [[ -n "${GITHUB_OAUTH_APP_ID}" ]]; then
  export GITHUB_OAUTH_APP_ID_ENCODED=$(printf "%s" "$GITHUB_OAUTH_APP_ID" | base64 | tr -d '\n')
fi
if [[ -n "${GITHUB_OAUTH_APP_SECRET}" ]]; then
  export GITHUB_OAUTH_APP_SECRET_ENCODED=$(printf "%s" "$GITHUB_OAUTH_APP_SECRET" | base64 | tr -d '\n')
fi

# ACR (Azure Container Registry) secrets
export ACR_SECRET=$(load_secret "ACR_SECRET")

# Additional RDS hosts
export RDS_1_HOST=$(load_secret "RDS_1_HOST")
export RDS_2_HOST=$(load_secret "RDS_2_HOST")
export RDS_3_HOST=$(load_secret "RDS_3_HOST")

# Keycloak Auth (alternative Keycloak instance)
export KEYCLOAK_AUTH_BASE_URL=$(load_secret "KEYCLOAK_AUTH_BASE_URL")
export KEYCLOAK_AUTH_CLIENTID=$(load_secret "KEYCLOAK_AUTH_CLIENTID")
export KEYCLOAK_AUTH_CLIENT_SECRET=$(load_secret "KEYCLOAK_AUTH_CLIENT_SECRET")
export KEYCLOAK_AUTH_LOGIN_REALM=$(load_secret "KEYCLOAK_AUTH_LOGIN_REALM")
export KEYCLOAK_AUTH_REALM=$(load_secret "KEYCLOAK_AUTH_REALM")

# Temporary cluster tokens
export K8S_CLUSTER_TOKEN_TEMPORARY=$(load_secret "K8S_CLUSTER_TOKEN_TEMPORARY")
export RHDH_PR_OS_CLUSTER_URL=$(load_secret "RHDH_PR_OS_CLUSTER_URL")
export RHDH_PR_OS_CLUSTER_TOKEN=$(load_secret "RHDH_PR_OS_CLUSTER_TOKEN")

# GKE (Google Kubernetes Engine) variables
export GKE_CLUSTER_NAME=$(load_secret "GKE_CLUSTER_NAME")
export GKE_CLUSTER_REGION=$(load_secret "GKE_CLUSTER_REGION")
export GKE_INSTANCE_DOMAIN_NAME=$(load_secret "GKE_INSTANCE_DOMAIN_NAME")
export GKE_SERVICE_ACCOUNT_NAME=$(load_secret "GKE_SERVICE_ACCOUNT_NAME")
export GKE_CERT_NAME=$(load_secret "GKE_CERT_NAME")

# EKS (Amazon EKS) variables
export AWS_ACCESS_KEY_ID=$(load_secret "AWS_ACCESS_KEY_ID")
export AWS_SECRET_ACCESS_KEY=$(load_secret "AWS_SECRET_ACCESS_KEY")
export AWS_DEFAULT_REGION=$(load_secret "AWS_DEFAULT_REGION")
export AWS_EKS_PARENT_DOMAIN=$(load_secret "AWS_EKS_PARENT_DOMAIN")

# Authentication Providers test variables
export AUTH_PROVIDERS_RHBK_BASE_URL=$(load_secret "AUTH_PROVIDERS_RHBK_BASE_URL")
export AUTH_PROVIDERS_RHBK_CLIENT_SECRET=$(load_secret "AUTH_PROVIDERS_RHBK_CLIENT_SECRET")
export AUTH_PROVIDERS_RHBK_CLIENT_ID=$(load_secret "AUTH_PROVIDERS_RHBK_CLIENT_ID")
export AUTH_PROVIDERS_RHBK_REALM=$(load_secret "AUTH_PROVIDERS_RHBK_REALM")
export AUTH_PROVIDERS_DEFAULT_USER_PASSWORD=$(load_secret "AUTH_PROVIDERS_DEFAULT_USER_PASSWORD")
export AUTH_PROVIDERS_DEFAULT_USER_PASSWORD_2=$(load_secret "AUTH_PROVIDERS_DEFAULT_USER_PASSWORD_2")

export AUTH_PROVIDERS_ARM_CLIENT_ID=$(load_secret "AUTH_PROVIDERS_ARM_CLIENT_ID")
export AUTH_PROVIDERS_ARM_CLIENT_SECRET=$(load_secret "AUTH_PROVIDERS_ARM_CLIENT_SECRET")
export AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID=$(load_secret "AUTH_PROVIDERS_ARM_SUBSCRIPTION_ID")
export AUTH_PROVIDERS_ARM_TENANT_ID=$(load_secret "AUTH_PROVIDERS_ARM_TENANT_ID")

export RHBK_LDAP_REALM=$(load_secret "RHBK_LDAP_REALM")
export RHBK_LDAP_CLIENT_ID=$(load_secret "RHBK_LDAP_CLIENT_ID")
export RHBK_LDAP_CLIENT_SECRET=$(load_secret "RHBK_LDAP_CLIENT_SECRET")
export RHBK_LDAP_USER_BIND=$(load_secret "RHBK_LDAP_USER_BIND")
export RHBK_LDAP_USER_PASSWORD=$(load_secret "RHBK_LDAP_USER_PASSWORD")
export RHBK_LDAP_TARGET=$(load_secret "RHBK_LDAP_TARGET")

export AUTH_PROVIDERS_AZURE_CLIENT_ID=$(load_secret "AUTH_PROVIDERS_AZURE_CLIENT_ID")
export AUTH_PROVIDERS_AZURE_CLIENT_SECRET=$(load_secret "AUTH_PROVIDERS_AZURE_CLIENT_SECRET")
export AUTH_PROVIDERS_AZURE_TENANT_ID=$(load_secret "AUTH_PROVIDERS_AZURE_TENANT_ID")

export AUTH_PROVIDERS_GH_ORG_NAME=$(load_secret "AUTH_PROVIDERS_GH_ORG_NAME")
export AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET=$(load_secret "AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET")
export AUTH_PROVIDERS_GH_ORG_CLIENT_ID=$(load_secret "AUTH_PROVIDERS_GH_ORG_CLIENT_ID")
export AUTH_PROVIDERS_GH_USER_PASSWORD=$(load_secret "AUTH_PROVIDERS_GH_USER_PASSWORD")
export AUTH_PROVIDERS_GH_USER_2FA=$(load_secret "AUTH_PROVIDERS_GH_USER_2FA")
export AUTH_PROVIDERS_GH_ADMIN_2FA=$(load_secret "AUTH_PROVIDERS_GH_ADMIN_2FA")
export AUTH_PROVIDERS_GH_ORG_APP_ID=$(load_secret "AUTH_PROVIDERS_GH_ORG_APP_ID")
export AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY=$(load_secret "AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY")
export AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET=$(load_secret "AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET")

# ============================================================================
# Local Environment Override
# ============================================================================
# Load local environment overrides for development
# This file should NOT be committed to git
LOCAL_ENV_OVERRIDE="${PIPELINES_ROOT}/config/env_override.local.sh"
if [[ -f "${LOCAL_ENV_OVERRIDE}" ]]; then
  echo "Loading local environment overrides from ${LOCAL_ENV_OVERRIDE}"
  # shellcheck source=/dev/null
  source "${LOCAL_ENV_OVERRIDE}"
fi

set +a # Stop automatically exporting variables

# ============================================================================
# Helper Functions
# ============================================================================

# Get the chart version dynamically from Quay
get_chart_version() {
  local chart_major_version=$1
  curl -sSX GET "https://quay.io/api/v1/repository/rhdh/chart/tag/?onlyActiveTags=true&filter_tag_name=like:${chart_major_version}-" \
    -H "Content-Type: application/json" \
    | jq '.tags[0].name' | grep -oE '[0-9]+\.[0-9]+-[0-9]+-CI'
}

# Set chart version if not already set
if [[ -z "${CHART_VERSION:-}" ]]; then
  export CHART_VERSION=$(get_chart_version "${CHART_MAJOR_VERSION}")
  echo "Detected CHART_VERSION: ${CHART_VERSION}"
fi

# ============================================================================
# Environment Validation
# ============================================================================
echo "=== Environment Configuration ==="
echo "OPENSHIFT_CI: ${OPENSHIFT_CI}"
echo "JOB_NAME: ${JOB_NAME}"
echo "TAG_NAME: ${TAG_NAME}"
echo "CHART_VERSION: ${CHART_VERSION}"
echo "PIPELINES_ROOT: ${PIPELINES_ROOT}"
echo "PROJECT_ROOT: ${PROJECT_ROOT}"
echo "================================="

