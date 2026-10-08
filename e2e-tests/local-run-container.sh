#!/usr/bin/env bash
set -e

# Invoked only after rhdh-e2e-secrets has retrieved and validated the profile.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=.ci/pipelines/lib/log.sh
source "$SCRIPT_DIR/../.ci/pipelines/lib/log.sh"
if [[ "${RHDH_E2E_SECRET_FD:-}" != 3 ]] || ! { true <&3; } 2> /dev/null; then
  log::error "Run local-run.sh to provide the secret stream."
  exit 1
fi

log::section "Setting up cluster access"
SA_NAME="rhdh-local-tester"
SA_NAMESPACE="rhdh-local-test"
SA_BINDING_NAME="${SA_NAME}-binding"
if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
  if ! oc cluster-info &> /dev/null; then
    log::error "Not logged into OpenShift cluster; run oc login."
    exit 1
  fi
  K8S_CLUSTER_URL=$(oc whoami --show-server)
  oc create namespace "$SA_NAMESPACE" 2> /dev/null || log::info "Namespace already exists"
  oc create serviceaccount "$SA_NAME" -n "$SA_NAMESPACE" 2> /dev/null || log::info "Service account already exists"
  oc adm policy add-cluster-role-to-user cluster-admin "system:serviceaccount:${SA_NAMESPACE}:${SA_NAME}" 2> /dev/null || true
  K8S_CLUSTER_TOKEN=$(oc create token "$SA_NAME" -n "$SA_NAMESPACE" --duration=8h)
else
  if ! kubectl cluster-info &> /dev/null; then
    log::error "Cannot connect to Kubernetes cluster; check your kubeconfig."
    exit 1
  fi
  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  kubectl create namespace "$SA_NAMESPACE" 2> /dev/null || log::info "Namespace already exists"
  kubectl create serviceaccount "$SA_NAME" -n "$SA_NAMESPACE" 2> /dev/null || log::info "Service account already exists"
  kubectl create clusterrolebinding "$SA_BINDING_NAME" \
    --clusterrole=cluster-admin \
    --serviceaccount="${SA_NAMESPACE}:${SA_NAME}" 2> /dev/null || true
  K8S_CLUSTER_TOKEN=$(kubectl create token "$SA_NAME" -n "$SA_NAMESPACE" --duration=8h)
fi
export RHDH_LOCAL_TEST_CLUSTER_TOKEN="$K8S_CLUSTER_TOKEN"
log::info "K8S_CLUSTER_URL: $K8S_CLUSTER_URL"

log::section "Copying repo to work directory"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="$SCRIPT_DIR/.local-test/rhdh"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
rsync -a --exclude='node_modules' --exclude='.env' --exclude='.local-test' --exclude='playwright-report' --exclude='test-results' "$REPO_ROOT/" "$WORK_DIR/"

log::section "Starting Container (rhdh-e2e-runner)"
PODMAN_ARGS=(
  run
  -v "$WORK_DIR":/tmp/rhdh
  -v "$SCRIPT_DIR/container-init.sh":/tmp/container-init.sh:ro
  -i -u root --privileged --rm
  --mount "type=tmpfs,destination=/tmp/secrets,tmpfs-mode=0700"
  -e K8S_CLUSTER_URL="$K8S_CLUSTER_URL"
  --env RHDH_LOCAL_TEST_CLUSTER_TOKEN
  -e CONTAINER_PLATFORM="$CONTAINER_PLATFORM"
  -e JOB_NAME="$JOB_NAME"
  -e IMAGE_REGISTRY="$IMAGE_REGISTRY"
  -e IMAGE_REPO="$IMAGE_REPO"
  -e TAG_NAME="$TAG_NAME"
  -e POSTGRESQL_IMAGE_REGISTRY="${POSTGRESQL_IMAGE_REGISTRY:-}"
  -e POSTGRESQL_IMAGE_REPO="${POSTGRESQL_IMAGE_REPO:-}"
  -e POSTGRESQL_IMAGE_TAG="${POSTGRESQL_IMAGE_TAG:-}"
  -e SKIP_TESTS="$SKIP_TESTS"
  -e DISCONNECTED="$DISCONNECTED"
  -e LOCAL_DISCONNECTED="${LOCAL_DISCONNECTED:-}"
  "$RUNNER_IMAGE"
  /bin/bash /tmp/container-init.sh
)
exec podman "${PODMAN_ARGS[@]}" 0<&3 3<&-
