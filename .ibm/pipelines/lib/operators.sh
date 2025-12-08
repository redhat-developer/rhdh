#!/usr/bin/env bash

# Operator and OLM installation utilities
# Dependencies: oc, kubectl, operator-sdk

set -euo pipefail

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
}

# Monitor operator status until expected phase is reached
# Args: timeout_seconds, namespace, operator_name, expected_status (default: "Succeeded")
operator::check_status() {
  local timeout=${1:-300}
  local namespace=$2
  local operator_name=$3
  local expected_status=${4:-"Succeeded"}

  echo "Checking the status of operator '${operator_name}' in namespace '${namespace}' with a timeout of ${timeout} seconds."
  echo "Expected status: ${expected_status}"

  timeout "${timeout}" bash -c "
    while true; do
      CURRENT_PHASE=\$(oc get csv -n '${namespace}' -o jsonpath='{.items[?(@.spec.displayName==\"${operator_name}\")].status.phase}')
      echo \"Operator '${operator_name}' current phase: \${CURRENT_PHASE}\"
      [[ \"\${CURRENT_PHASE}\" == \"${expected_status}\" ]] && echo \"Operator '${operator_name}' is now in '${expected_status}' phase.\" && break
      sleep 10
    done
  " || echo "Timed out after ${timeout} seconds. Operator '${operator_name}' did not reach '${expected_status}' phase."
}

# Install Crunchy Postgres Operator from OpenShift Marketplace
operator::install_postgres_ocp() {
  operator::install_subscription postgresql openshift-operators v5 postgresql community-operators openshift-marketplace
  operator::check_status 300 "openshift-operators" "Crunchy Postgres for Kubernetes" "Succeeded"
}

# Install Crunchy Postgres Operator from OperatorHub.io
operator::install_postgres_k8s() {
  operator::install_subscription postgresql openshift-operators v5 postgresql community-operators openshift-marketplace
  operator::check_status 300 "operators" "Crunchy Postgres for Kubernetes" "Succeeded"
}

# Install OpenShift Serverless Logic Operator (SonataFlow)
operator::install_serverless_logic() {
  operator::install_subscription logic-operator-rhel8 openshift-operators alpha logic-operator-rhel8 redhat-operators openshift-marketplace
  operator::check_status 300 "openshift-operators" "OpenShift Serverless Logic Operator" "Succeeded"
}

# Install OpenShift Serverless Operator (Knative)
operator::install_serverless() {
  operator::install_subscription serverless-operator openshift-operators stable serverless-operator redhat-operators openshift-marketplace
  operator::check_status 300 "openshift-operators" "Red Hat OpenShift Serverless" "Succeeded"
}

# Install Red Hat OpenShift Pipelines operator if not present
operator::install_pipelines() {
  local display_name="Red Hat OpenShift Pipelines"

  if oc get csv -n "openshift-operators" | grep -q "${display_name}"; then
    echo "Red Hat OpenShift Pipelines operator is already installed."
    return 0
  fi

  echo "Red Hat OpenShift Pipelines operator is not installed. Installing..."
  operator::install_subscription openshift-pipelines-operator openshift-operators latest openshift-pipelines-operator-rh redhat-operators openshift-marketplace

  # Note: Calling script should wait for deployment:
  # k8s_wait::deployment "openshift-operators" "pipelines"
  # k8s_wait::endpoint "tekton-pipelines-webhook" "openshift-pipelines"
}

# Install Tekton Pipelines (alternative to OpenShift Pipelines for Kubernetes)
operator::install_tekton() {
  local display_name="tekton-pipelines-webhook"

  if oc get pods -n "tekton-pipelines" | grep -q "${display_name}"; then
    echo "Tekton Pipelines are already installed."
    return 0
  fi

  echo "Tekton Pipelines is not installed. Installing..."
  kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml

  # Note: Calling script should wait for deployment:
  # k8s_wait::deployment "tekton-pipelines" "${display_name}"
  # k8s_wait::endpoint "tekton-pipelines-webhook" "tekton-pipelines"
}

# Delete Tekton Pipelines installation
operator::delete_tekton() {
  echo "Checking for Tekton Pipelines installation..."

  if ! kubectl get namespace tekton-pipelines &> /dev/null; then
    echo "Tekton Pipelines is not installed. Nothing to delete."
    return 0
  fi

  echo "Found Tekton Pipelines installation. Attempting to delete..."
  kubectl delete -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml --ignore-not-found=true 2> /dev/null || true

  echo "Waiting for Tekton Pipelines namespace to be deleted..."
  timeout 30 bash -c '
    while kubectl get namespace tekton-pipelines &> /dev/null; do
      echo "Waiting for tekton-pipelines namespace deletion..."
      sleep 5
    done
    echo "Tekton Pipelines deleted successfully."
  ' || echo "Warning: Timed out waiting for namespace deletion, continuing..."

  return 0
}

# Install Operator Lifecycle Manager if not present
operator::install_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    echo "OLM is already installed."
    return 0
  fi

  echo "OLM is not installed. Installing..."
  operator-sdk olm install
}

# Uninstall Operator Lifecycle Manager if present
operator::uninstall_olm() {
  if operator-sdk olm status > /dev/null 2>&1; then
    echo "OLM is installed. Uninstalling..."
    operator-sdk olm uninstall
    return 0
  fi

  echo "OLM is not installed. Nothing to uninstall."
  return 0
}
