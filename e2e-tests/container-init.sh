#!/bin/bash

# Source logging library
# shellcheck source=../.ibm/pipelines/lib/log.sh
source "/tmp/rhdh/.ibm/pipelines/lib/log.sh"

# Trap errors and exit with error code
handle_error() {
    local exit_code=$?
    echo ""
    log::error "Container script failed! (exit code: $exit_code)"
    echo ""
    log::info "Check the logs above for details."
    log::info "Pod logs are saved to: .local-test/rhdh/.local-test/artifact_dir/"
    echo ""
    exit $exit_code
}
trap handle_error ERR

set -e

# Install vault if not present
if ! command -v vault &> /dev/null; then
    VAULT_VERSION="${VAULT_VERSION:-1.15.4}"
    log::info "Installing vault ${VAULT_VERSION}..."
    curl -fsSL "https://releases.hashicorp.com/vault/${VAULT_VERSION}/vault_${VAULT_VERSION}_linux_amd64.zip" -o /tmp/vault.zip
    unzip -q /tmp/vault.zip -d /usr/local/bin/
    rm /tmp/vault.zip
fi

# Fetch and write secrets to /tmp/secrets/
log::section "Fetching Vault Secrets"
SECRETS=$(vault kv get -format=json -mount="kv" "selfservice/rhdh-qe/rhdh" | jq -r ".data.data")

for key in $(echo "$SECRETS" | jq -r "keys[]"); do
    if [[ "$key" == */* ]]; then
        mkdir -p "/tmp/secrets/$(dirname "$key")"
    fi
    echo "$SECRETS" | jq -r --arg k "$key" '.[$k]' > "/tmp/secrets/$key"
done

log::success "Secrets written to /tmp/secrets/"

# Login using service account token from host
log::section "Cluster Service Account and Token Management"

# K8S_CLUSTER_URL, K8S_CLUSTER_TOKEN, and CONTAINER_PLATFORM are passed from local-run.sh
export K8S_CLUSTER_URL
export K8S_CLUSTER_TOKEN
export CONTAINER_PLATFORM
log::info "K8S_CLUSTER_URL: $K8S_CLUSTER_URL"
log::info "CONTAINER_PLATFORM: $CONTAINER_PLATFORM"

# Login based on platform
if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
    oc login --token="$K8S_CLUSTER_TOKEN" --server="$K8S_CLUSTER_URL" --insecure-skip-tls-verify=true
else
    # For AKS/EKS/GKE, configure kubectl with the token
    kubectl config set-cluster local-cluster --server="$K8S_CLUSTER_URL" --insecure-skip-tls-verify=true
    kubectl config set-credentials local-user --token="$K8S_CLUSTER_TOKEN"
    kubectl config set-context local-context --cluster=local-cluster --user=local-user
    kubectl config use-context local-context
    kubectl cluster-info
fi

log::info "Service account token is valid for 48 hours."

log::section "Platform Environment Variables"

export SHARED_DIR="/tmp/rhdh/.local-test/shared_dir"
mkdir -p "$SHARED_DIR"
log::info "SHARED_DIR=${SHARED_DIR}"

export ARTIFACT_DIR="/tmp/rhdh/.local-test/artifact_dir"
mkdir -p "$ARTIFACT_DIR"
log::info "ARTIFACT_DIR=${ARTIFACT_DIR}"

# Set IS_OPENSHIFT based on platform
if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
    export IS_OPENSHIFT="true"
else
    export IS_OPENSHIFT="false"
fi
log::info "IS_OPENSHIFT=${IS_OPENSHIFT}"

# These are passed from local-run.sh - export them for child scripts
export JOB_NAME
export QUAY_REPO
export TAG_NAME
export SKIP_TESTS
log::info "JOB_NAME=${JOB_NAME}"
log::info "QUAY_REPO=${QUAY_REPO}"
log::info "TAG_NAME=${TAG_NAME}"
log::info "SKIP_TESTS=${SKIP_TESTS}"

export RELEASE_BRANCH_NAME="main"
log::info "RELEASE_BRANCH_NAME=${RELEASE_BRANCH_NAME}"

log::info "CONTAINER_PLATFORM=${CONTAINER_PLATFORM}"

# Get platform version based on platform type
log::info "Getting container platform version"
if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
    CONTAINER_PLATFORM_VERSION=$(oc version --output json 2> /dev/null | jq -r ".openshiftVersion" | cut -d"." -f1,2 || echo "unknown")
else
    CONTAINER_PLATFORM_VERSION=$(kubectl version --output json 2> /dev/null | jq -r '.serverVersion.major + "." + .serverVersion.minor' || echo "unknown")
fi
export CONTAINER_PLATFORM_VERSION
log::info "CONTAINER_PLATFORM_VERSION=${CONTAINER_PLATFORM_VERSION}"

log::section "Current branch"
cd /tmp/rhdh
log::info "Current branch: $(git branch --show-current)"
log::info "Using Image: ${QUAY_REPO}:${TAG_NAME}"

# Pre-compute URLs and save config BEFORE deployment (so it's available even if deployment fails)
log::section "Preparing Configuration"

if [[ "$IS_OPENSHIFT" == "true" ]]; then
    # OpenShift platforms - get router base from console route
    K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
    if [[ "$JOB_NAME" == *"operator"* ]]; then
        SHOWCASE_URL="https://backstage-showcase.${K8S_CLUSTER_ROUTER_BASE}"
        SHOWCASE_RBAC_URL="https://backstage-showcase-rbac.${K8S_CLUSTER_ROUTER_BASE}"
    else
        SHOWCASE_URL="https://rhdh-developer-hub-showcase.${K8S_CLUSTER_ROUTER_BASE}"
        SHOWCASE_RBAC_URL="https://rhdh-rbac-developer-hub-showcase-rbac.${K8S_CLUSTER_ROUTER_BASE}"
    fi
else
    # Non-OpenShift platforms (AKS/EKS/GKE) - URLs will be determined after deployment via ingress
    log::info "Non-OpenShift platform detected. URLs will be determined after deployment."
    SHOWCASE_URL="TBD_AFTER_DEPLOYMENT"
    SHOWCASE_RBAC_URL="TBD_AFTER_DEPLOYMENT"
fi

# Save config early so it's available even if one deployment fails
mkdir -p /tmp/rhdh/.local-test
cat > /tmp/rhdh/.local-test/config.env <<EOF
# Auto-generated by container-init.sh
# Generated at: $(date)
SHOWCASE_URL="${SHOWCASE_URL}"
SHOWCASE_RBAC_URL="${SHOWCASE_RBAC_URL}"
JOB_NAME="${JOB_NAME}"
QUAY_REPO="${QUAY_REPO}"
TAG_NAME="${TAG_NAME}"
K8S_CLUSTER_URL="${K8S_CLUSTER_URL}"
CONTAINER_PLATFORM="${CONTAINER_PLATFORM}"
IS_OPENSHIFT="${IS_OPENSHIFT}"
EOF
log::info "Config saved to: .local-test/config.env"
log::info "  Showcase URL:      ${SHOWCASE_URL}"
log::info "  Showcase RBAC URL: ${SHOWCASE_RBAC_URL}"

log::section "Test Execution"
log::info "Executing openshift-ci-tests.sh"
DEPLOYMENT_EXIT_CODE=0
bash ./.ibm/pipelines/openshift-ci-tests.sh || DEPLOYMENT_EXIT_CODE=$?

log::section "Done"

echo ""
if [[ "${SKIP_TESTS:-false}" == "true" ]]; then
    log::section "DEPLOYMENT COMPLETE - TESTS SKIPPED"
else
    log::section "DEPLOYMENT AND TESTS COMPLETE"
fi

log::info "Configuration:"
log::info "  JOB_NAME:   ${JOB_NAME}"
log::info "  IMAGE:      quay.io/${QUAY_REPO}:${TAG_NAME}"
echo ""
log::info "Deployed URLs:"
log::info "  Showcase:      ${SHOWCASE_URL}"
log::info "  Showcase RBAC: ${SHOWCASE_RBAC_URL}"
echo ""

if [[ "$DEPLOYMENT_EXIT_CODE" -ne 0 ]]; then
    log::warn "Deployment had errors (exit code: $DEPLOYMENT_EXIT_CODE)"
    log::info "One or more deployments may have failed, but config.env is saved."
    log::info "You can still run tests against any successful deployment."
    exit $DEPLOYMENT_EXIT_CODE
fi

# Container will exit and local-run.sh will show next steps
