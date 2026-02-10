#!/bin/bash
# This script sets up your local environment for running Playwright tests in headed mode.
# It reads config from .local-test/rhdh/.local-test/config.env and exports all secrets as environment variables.
# Supports both OpenShift (OCP, OSD-GCP) and non-OpenShift (AKS, EKS, GKE) platforms.
#
# Usage (run from e2e-tests directory):
#   source local-test-setup.sh [showcase|rbac]
#
# Examples:
#   cd e2e-tests
#   source local-test-setup.sh           # Uses Showcase URL (default)
#   source local-test-setup.sh showcase  # Uses Showcase URL
#   source local-test-setup.sh rbac      # Uses Showcase RBAC URL
#
# After sourcing, you can run tests:
#   yarn install
#   yarn playwright test --headed

# Get script directory (works even when sourced)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$SCRIPT_DIR/.local-test/rhdh"
CONFIG_FILE="$WORK_DIR/.local-test/config.env"

# Source logging library
# shellcheck source=../.ibm/pipelines/lib/log.sh
source "$SCRIPT_DIR/../.ibm/pipelines/lib/log.sh"

# Check if config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    log::error "Config file not found: $CONFIG_FILE"
    echo ""
    log::info "Please run deployment first:"
    log::info "  cd e2e-tests && ./local-run.sh"
    echo ""
    log::info "Note: The work copy is created at e2e-tests/.local-test/rhdh"
    return 1 2>/dev/null || exit 1
fi

# Load config
log::info "Loading config from: $CONFIG_FILE"
source "$CONFIG_FILE"

# Select URL based on argument
TEST_TYPE="${1:-showcase}"
case "$TEST_TYPE" in
    showcase)
        export BASE_URL="$SHOWCASE_URL"
        log::info "Test type: Showcase"
        ;;
    rbac)
        export BASE_URL="$SHOWCASE_RBAC_URL"
        log::info "Test type: Showcase RBAC"
        ;;
    *)
        log::error "Unknown test type: $TEST_TYPE"
        log::info "Valid options: showcase, rbac"
        return 1 2>/dev/null || exit 1
        ;;
esac

log::info "BASE_URL: $BASE_URL"
echo ""

# Export config vars
export JOB_NAME
export QUAY_REPO
export TAG_NAME
export K8S_CLUSTER_URL
export SHOWCASE_URL
export SHOWCASE_RBAC_URL
export CONTAINER_PLATFORM
export IS_OPENSHIFT

log::info "Configuration:"
log::info "  JOB_NAME:         $JOB_NAME"
log::info "  PLATFORM:         $CONTAINER_PLATFORM"
log::info "  IMAGE:            quay.io/${QUAY_REPO}:${TAG_NAME}"
log::info "  K8S_CLUSTER_URL:  $K8S_CLUSTER_URL"
echo ""

# Get K8S_CLUSTER_TOKEN fresh (not stored in file for security)
log::info "Getting K8S_CLUSTER_TOKEN from cluster..."
SA_NAME="rhdh-local-tester"
SA_NAMESPACE="rhdh-local-test"
SA_SECRET_NAME="${SA_NAME}-secret"

if [[ "$IS_OPENSHIFT" == "true" ]]; then
    # OpenShift platforms - use oc create token
    if ! oc whoami &>/dev/null; then
        log::error "Not logged into OpenShift."
        log::info "Please login first: oc login"
        return 1 2>/dev/null || exit 1
    fi
    K8S_CLUSTER_TOKEN=$(oc create token "$SA_NAME" -n "$SA_NAMESPACE" --duration=48h)
else
    # Non-OpenShift platforms (AKS/EKS/GKE) - get token from secret
    if ! kubectl cluster-info &>/dev/null; then
        log::error "Cannot connect to Kubernetes cluster."
        log::info "Please ensure your kubeconfig is set correctly: kubectl cluster-info"
        return 1 2>/dev/null || exit 1
    fi
    token=$(kubectl get secret ${SA_SECRET_NAME} -n ${SA_NAMESPACE} -o jsonpath='{.data.token}' 2>/dev/null)
    if [[ -z "$token" ]]; then
        log::error "Service account token not found."
        log::info "Please run deployment first: ./local-run.sh"
        return 1 2>/dev/null || exit 1
    fi
    K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
fi
export K8S_CLUSTER_TOKEN
log::success "K8S_CLUSTER_TOKEN: [set]"
echo ""

export VAULT_ADDR='https://vault.ci.openshift.org'

# Check if already logged into vault
if ! vault token lookup &>/dev/null; then
    log::info "Logging into vault..."
    vault login -no-print -method=oidc
fi

log::info "Exporting secrets as environment variables..."
if [ -n "$ZSH_VERSION" ]; then
    # --- ZSH / macOS FIX ---
    # Fix: Vault flag order, printf to avoid control char interpretation, while loop for safety
    SECRETS_JSON=$(vault kv get -mount="kv" -format=json "selfservice/rhdh-qe/rhdh" | jq -r '.data.data')
    
    while read -r key; do
        [[ "$key" == "secretsync/"* ]] && continue
        value=$(printf '%s' "$SECRETS_JSON" | jq -r --arg k "$key" '.[$k]')
        safe_key=$(echo "$key" | tr './-' '___')
        export "$safe_key"="$value"
    done < <(printf '%s' "$SECRETS_JSON" | jq -r 'keys[]')

elif [ -n "$BASH_VERSION" ]; then
    # --- ORIGINAL BASH LOGIC ---
    SECRETS_JSON=$(vault kv get -format=json -mount="kv" "selfservice/rhdh-qe/rhdh" | jq -r '.data.data')
    
    for key in $(echo "$SECRETS_JSON" | jq -r 'keys[]'); do
        [[ "$key" == "secretsync/"* ]] && continue
        value=$(echo "$SECRETS_JSON" | jq -r --arg k "$key" '.[$k]')
        safe_key=$(echo "$key" | tr './-' '___')
        export "$safe_key"="$value"
    done
fi

log::section "Environment Ready"
log::info "Available URLs:"
log::info "  Showcase:      $SHOWCASE_URL"
log::info "  Showcase RBAC: $SHOWCASE_RBAC_URL"
echo ""
log::info "Current BASE_URL: $BASE_URL"
echo ""
log::info "To run tests:"
echo "  cd e2e-tests"
echo "  yarn install"
echo "  yarn playwright test --headed"
echo ""
log::info "To switch to RBAC tests:"
echo "  export BASE_URL=\"$SHOWCASE_RBAC_URL\""
echo ""
