#!/usr/bin/env bash

# Operator and OLM installation utilities
# Dependencies: oc, kubectl, operator-sdk

# Prevent re-sourcing
if [[ -n "${OPERATORS_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly OPERATORS_LIB_SOURCED=1

# Constants
readonly OPERATOR_NAMESPACE="openshift-operators"

# Create OpenShift Operator subscription
# Args: name, namespace, channel, package, source_name, source_namespace
operator::install_subscription() {
  local name=$1
  local namespace=$2
  local channel=$3
  local package=$4
  local source_name=$5
  local source_namespace=$6

  oc apply -f - << EOD
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: $name
  namespace: $namespace
spec:
  channel: $channel
  installPlanApproval: Automatic
  name: $package
  source: $source_name
  sourceNamespace: $source_namespace
EOD
  return $?
}

# Install Red Hat OpenShift Pipelines operator if not present
operator::install_pipelines() {
  local display_name="Red Hat OpenShift Pipelines"

  if oc get csv -n "${OPERATOR_NAMESPACE}" | grep -q "${display_name}"; then
    log::info "Red Hat OpenShift Pipelines operator is already installed."
    return 0
  fi

  log::info "Red Hat OpenShift Pipelines operator is not installed. Installing..."
  operator::install_subscription openshift-pipelines-operator "${OPERATOR_NAMESPACE}" latest openshift-pipelines-operator-rh redhat-operators openshift-marketplace

  # Wait for Tekton Pipelines CRDs to be available
  log::info "Waiting for Tekton Pipelines CRDs to be created..."
  k8s_wait::crd "tasks.tekton.dev" 300 10 || return 1
  k8s_wait::crd "pipelines.tekton.dev" 300 10 || return 1

  # Note: Calling script should still wait for deployment readiness:
  # k8s_wait::deployment "openshift-operators" "pipelines" 30 10
  # k8s_wait::endpoint "tekton-pipelines-webhook" "openshift-pipelines" 30 10
  return 0
}

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
