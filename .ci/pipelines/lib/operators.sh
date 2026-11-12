#!/usr/bin/env bash

# Operator and OLM installation utilities
# Dependencies: oc, kubectl, operator-sdk

if [[ -n "${OPERATORS_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly OPERATORS_LIB_SOURCED=1

# Install Tekton Pipelines (alternative to OpenShift Pipelines for Kubernetes)
operator::install_tekton() {
  local display_name="tekton-pipelines-webhook"
  local ns="tekton-pipelines"

  if ! kubectl get namespace "${ns}" &> /dev/null; then
    log::info "Tekton Pipelines is not installed. Installing..."
    kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
  else
    log::info "Tekton Pipelines namespace exists; ensuring webhook is ready before continuing."
  fi

  log::info "Waiting for Tekton Pipeline CRD and webhook (required before applying Pipeline manifests)..."
  k8s_wait::crd "pipelines.tekton.dev" 120 5 || return 1
  k8s_wait::deployment "${ns}" "${display_name}" 30 10 || return 1
  k8s_wait::endpoint "${display_name}" "${ns}" 1800 10 || return 1
  return 0
}

# Install Operator Lifecycle Manager if not present
operator::install_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    log::info "OLM is already installed."
    return 0
  fi

  log::info "OLM is not installed. Installing..."
  operator-sdk olm install
  return $?
}

# Uninstall Operator Lifecycle Manager if present
operator::uninstall_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    log::info "OLM is installed. Uninstalling..."
    operator-sdk olm uninstall
    return 0
  fi

  log::info "OLM is not installed. Nothing to uninstall."
  return 0
}
