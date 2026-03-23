#!/usr/bin/env bash

# Common utility functions for pipeline scripts
# Dependencies: oc, kubectl, lib/log.sh

# Prevent re-sourcing
if [[ -n "${COMMON_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly COMMON_LIB_SOURCED=1

# Source logging library
# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Authenticate to OpenShift cluster using token
# Uses K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL env vars
common::oc_login() {
  common::require_vars K8S_CLUSTER_TOKEN K8S_CLUSTER_URL
  if ! command -v oc &> /dev/null; then
    log::error "oc command not found. Please install OpenShift CLI."
    return 1
  fi

  log::info "Logging into OpenShift cluster..."
  if ! oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}" \
    --insecure-skip-tls-verify=true &> /dev/null; then
    log::error "Failed to authenticate to OpenShift cluster"
    return 1
  fi

  if ! oc whoami &> /dev/null; then
    log::error "Authentication verification failed for OpenShift cluster"
    return 1
  fi

  return 0
}

# Authenticate to Kubernetes cluster using service account token
# Uses K8S_CLUSTER_TOKEN and K8S_CLUSTER_URL env vars
common::kubectl_login() {
  common::require_vars K8S_CLUSTER_TOKEN K8S_CLUSTER_URL
  if ! command -v kubectl &> /dev/null; then
    log::error "kubectl command not found. Please install Kubernetes CLI."
    return 1
  fi

  log::info "Logging into Kubernetes cluster..."
  if ! kubectl config set-credentials sa-user --token="${K8S_CLUSTER_TOKEN}" &> /dev/null \
    || ! kubectl config set-cluster k8s-cluster --server="${K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true &> /dev/null \
    || ! kubectl config set-context k8s-context --cluster=k8s-cluster --user=sa-user &> /dev/null \
    || ! kubectl config use-context k8s-context &> /dev/null; then
    log::error "Failed to configure kubectl for Kubernetes cluster"
    return 1
  fi

  if ! kubectl auth can-i get nodes &> /dev/null; then
    log::error "Authentication verification failed for Kubernetes cluster"
    return 1
  fi

  return 0
}
