#!/usr/bin/env bash

# Operator and OLM installation utilities
# Dependencies: oc, kubectl, operator-sdk

# Prevent re-sourcing
if [[ -n "${OPERATORS_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly OPERATORS_LIB_SOURCED=1

# Constants
readonly OPERATOR_STATUS_SUCCEEDED="Succeeded"
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

# Monitor operator status until expected phase is reached
# Args: timeout_seconds, namespace, operator_name, expected_status (default: "Succeeded")
operator::check_status() {
  local timeout=${1:-300}
  local namespace=$2
  local operator_name=$3
  local expected_status=${4:-${OPERATOR_STATUS_SUCCEEDED}}

  log::info "Checking the status of operator '${operator_name}' in namespace '${namespace}' with a timeout of ${timeout} seconds."
  log::info "Expected status: ${expected_status}"

  timeout "${timeout}" bash -c "
    while true; do
      CURRENT_PHASE=\$(oc get csv -n '${namespace}' -o jsonpath='{.items[?(@.spec.displayName==\"${operator_name}\")].status.phase}')
      echo \"Operator '${operator_name}' current phase: \${CURRENT_PHASE}\"
      [[ \"\${CURRENT_PHASE}\" == \"${expected_status}\" ]] && echo \"Operator '${operator_name}' is now in '${expected_status}' phase.\" && break
      sleep 10
    done
  " || log::error "Timed out after ${timeout} seconds. Operator '${operator_name}' did not reach '${expected_status}' phase."
  return $?
}

# Install Crunchy Postgres Operator from OpenShift Marketplace
operator::install_postgres_ocp() {
  operator::install_subscription crunchy-postgres-operator "${OPERATOR_NAMESPACE}" v5 crunchy-postgres-operator certified-operators openshift-marketplace
  operator::check_status 300 "${OPERATOR_NAMESPACE}" "Crunchy Postgres for Kubernetes" "${OPERATOR_STATUS_SUCCEEDED}" || return 1

  # Wait for PostgresCluster CRD to be registered
  log::info "Waiting for PostgresCluster CRD to be registered..."
  k8s_wait::crd "postgresclusters.postgres-operator.crunchydata.com" 120 5 || return 1
  return 0
}

# Install OpenShift Serverless Logic Operator (SonataFlow)
operator::install_serverless_logic() {
  operator::install_subscription logic-operator-rhel8 "${OPERATOR_NAMESPACE}" alpha logic-operator-rhel8 redhat-operators openshift-marketplace
  operator::check_status 300 "${OPERATOR_NAMESPACE}" "OpenShift Serverless Logic Operator (Alpha)" "${OPERATOR_STATUS_SUCCEEDED}"
  return $?
}

# Install OpenShift Serverless Operator (Knative)
operator::install_serverless() {
  operator::install_subscription serverless-operator "${OPERATOR_NAMESPACE}" stable serverless-operator redhat-operators openshift-marketplace
  operator::check_status 300 "${OPERATOR_NAMESPACE}" "Red Hat OpenShift Serverless" "${OPERATOR_STATUS_SUCCEEDED}"
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
