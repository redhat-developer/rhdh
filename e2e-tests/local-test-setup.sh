#!/bin/bash
# This script sets up your local environment for running Playwright tests in headed mode.
# It reads config from .local-test/rhdh/.local-test/config.env and exports all secrets as environment variables.
# Supports both OpenShift (OCP, OSD-GCP) and non-OpenShift (AKS, EKS, GKE) platforms.
#
# Usage (run from e2e-tests directory):
#   source local-test-setup.sh [showcase|rbac] [--env]
#
# Options:
#   showcase|rbac  Select the test type (default: showcase)
#   --env          Generate a .env file in e2e-tests/ for Playwright Test Agents
#
# Examples:
#   cd e2e-tests
#   source local-test-setup.sh           # Uses Showcase URL (default)
#   source local-test-setup.sh showcase  # Uses Showcase URL
#   source local-test-setup.sh rbac      # Uses Showcase RBAC URL
#   source local-test-setup.sh rbac --env # RBAC + generate .env file
#
# After sourcing, you can run tests:
#   yarn install
#   yarn playwright test --headed

# Get script directory (works even when sourced)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$SCRIPT_DIR/.local-test/rhdh"
CONFIG_FILE="$WORK_DIR/.local-test/config.env"

# Source logging library
# shellcheck source=../.ci/pipelines/lib/log.sh
source "$SCRIPT_DIR/../.ci/pipelines/lib/log.sh"

# Check if config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
  log::error "Config file not found: $CONFIG_FILE"
  echo ""
  log::info "Please run deployment first:"
  log::info "  cd e2e-tests && ./local-run.sh"
  echo ""
  log::info "Note: The work copy is created at e2e-tests/.local-test/rhdh"
  return 1 2> /dev/null || exit 1
fi

# Load config
log::info "Loading config from: $CONFIG_FILE"
# shellcheck source=/dev/null
source "$CONFIG_FILE"

# Parse arguments
GENERATE_ENV=false
TEST_TYPE="showcase"
for arg in "$@"; do
  case "$arg" in
    --env) GENERATE_ENV=true ;;
    showcase | rbac) TEST_TYPE="$arg" ;;
    *) log::warn "Unknown argument: $arg (ignored)" ;;
  esac
done

# Select URL based on argument
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
    return 1 2> /dev/null || exit 1
    ;;
esac

log::info "BASE_URL: $BASE_URL"
echo ""

# Export config vars
export JOB_NAME
export IMAGE_REGISTRY
export IMAGE_REPO
export TAG_NAME
export K8S_CLUSTER_URL
export SHOWCASE_URL
export SHOWCASE_RBAC_URL
export CONTAINER_PLATFORM
export IS_OPENSHIFT

log::info "Configuration:"
log::info "  JOB_NAME:         $JOB_NAME"
log::info "  PLATFORM:         $CONTAINER_PLATFORM"
log::info "  IMAGE:            ${IMAGE_REGISTRY}/${IMAGE_REPO}:${TAG_NAME}"
log::info "  K8S_CLUSTER_URL:  $K8S_CLUSTER_URL"
echo ""

# Get K8S_CLUSTER_TOKEN fresh (not stored in file for security)
log::info "Getting K8S_CLUSTER_TOKEN from cluster..."
SA_NAME="rhdh-local-tester"
SA_NAMESPACE="rhdh-local-test"

if [[ "$IS_OPENSHIFT" == "true" ]]; then
  # OpenShift platforms - use oc create token
  if ! oc whoami &> /dev/null; then
    log::error "Not logged into OpenShift."
    log::info "Please login first: oc login"
    return 1 2> /dev/null || exit 1
  fi
  K8S_CLUSTER_TOKEN=$(oc create token "$SA_NAME" -n "$SA_NAMESPACE" --duration=8h)
else
  # Non-OpenShift platforms (AKS/EKS/GKE) - use short-lived token via TokenRequest API
  if ! kubectl cluster-info &> /dev/null; then
    log::error "Cannot connect to Kubernetes cluster."
    log::info "Please ensure your kubeconfig is set correctly: kubectl cluster-info"
    return 1 2> /dev/null || exit 1
  fi
  K8S_CLUSTER_TOKEN=$(kubectl create token "$SA_NAME" -n "$SA_NAMESPACE" --duration=8h)
fi
export K8S_CLUSTER_TOKEN
log::success "K8S_CLUSTER_TOKEN: [set]"
echo ""

export VAULT_ADDR='https://vault.ci.openshift.org'

# Check if already logged into vault
if ! vault token lookup &> /dev/null; then
  log::info "Logging into vault..."
  vault login -no-print -method=oidc
fi

log::info "Exporting secrets as environment variables..."
# Export secrets safely without eval (avoids code injection risk)
# Uses base64 encoding to safely handle special characters in values
# Replaces -, . and / with _ in key names (env vars can only have alphanumeric and _)
SECRETS_JSON=$(vault kv get -format=json -mount="kv" "selfservice/rhdh-qe/rhdh" | jq -r '.data.data')
# Use while read (not for..in) so it works in both bash and zsh; avoids word-splitting/globbing on keys
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  [[ "$key" == "secretsync/"* ]] && continue
  value=$(printf '%s' "$SECRETS_JSON" | jq -r --arg k "$key" '.[$k]')
  safe_key=$(echo "$key" | tr './-' '___')
  export "$safe_key"="$value"
done < <(printf '%s' "$SECRETS_JSON" | jq -r 'keys[]')

# Generate .env file for Playwright Test Agents (healer, planner, generator)
# Only when --env flag is passed. The .env file is gitignored and must never be committed.
if [[ "$GENERATE_ENV" == "true" ]]; then
  ENV_FILE="$SCRIPT_DIR/.env"
  # Create temp file with restrictive permissions from the start
  ENV_TMP="$(umask 077 && mktemp "${ENV_FILE}.XXXXXX")"
  log::info "Generating .env file: $ENV_FILE"

  # Helper: single-quote a value for .env to handle multiline content (PEM certs, private keys)
  env_quote() {
    local val="$1"
    # Escape existing single quotes: ' → '"'"'
    val="${val//\'/\'\"\'\"\'}"
    printf "'%s'" "$val"
    return 0
  }

  # Write to a temp file first, then atomically move into place.
  {
    echo "# Auto-generated by local-test-setup.sh --env — do not commit"
    echo "# Regenerate by running: source local-test-setup.sh <showcase|rbac> --env"
    echo ""
    echo "BASE_URL=$(env_quote "$BASE_URL")"
    echo "K8S_CLUSTER_URL=$(env_quote "$K8S_CLUSTER_URL")"
    echo "K8S_CLUSTER_TOKEN=$(env_quote "$K8S_CLUSTER_TOKEN")"
    echo "JOB_NAME=$(env_quote "$JOB_NAME")"
    echo "IMAGE_REGISTRY=$(env_quote "$IMAGE_REGISTRY")"
    echo "IMAGE_REPO=$(env_quote "$IMAGE_REPO")"
    echo "TAG_NAME=$(env_quote "$TAG_NAME")"
    echo "SHOWCASE_URL=$(env_quote "$SHOWCASE_URL")"
    echo "SHOWCASE_RBAC_URL=$(env_quote "$SHOWCASE_RBAC_URL")"
    echo "CONTAINER_PLATFORM=$(env_quote "$CONTAINER_PLATFORM")"
    echo "IS_OPENSHIFT=$(env_quote "$IS_OPENSHIFT")"
    echo ""
    echo "# Vault secrets"
    # Write each vault secret as KEY='VALUE', using the same safe_key transform
    # Single-quoting handles multiline values (PEM certs, private keys)
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      [[ "$key" == "secretsync/"* ]] && continue
      value=$(printf '%s' "$SECRETS_JSON" | jq -r --arg k "$key" '.[$k]')
      safe_key=$(echo "$key" | tr './-' '___')
      echo "$safe_key=$(env_quote "$value")"
    done < <(printf '%s' "$SECRETS_JSON" | jq -r 'keys[]')
  } > "$ENV_TMP"
  mv -f "$ENV_TMP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log::success ".env file written with $(wc -l < "$ENV_FILE" | tr -d ' ') lines (mode 600)"
  echo ""
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
