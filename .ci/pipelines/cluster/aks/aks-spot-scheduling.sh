#!/bin/bash

# Prevent re-sourcing: the readonly constants below would fail a second source under errexit.
if [[ -n "${AKS_SPOT_SCHEDULING_SOURCED:-}" ]]; then
  return 0
fi
readonly AKS_SPOT_SCHEDULING_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/lib/operators.sh
source "$DIR"/lib/operators.sh

# AKS taints every spot node pool with kubernetes.azure.com/scalesetpriority=spot:NoSchedule and
# refuses to remove the taint, so a pod without the toleration can only land on the single-node
# 2 vCPU system pool, which is too small for Tekton and OLM.
#
# Kubernetes 1.35, the version the release-1.10 AKS jobs run, has no MutatingAdmissionPolicy, so
# the toleration is added to each workload instead. None of these workloads sets tolerations, so
# the list is replaced rather than appended to. Running a patch twice is harmless.
readonly AKS_SPOT_TOLERATIONS='[{"key":"kubernetes.azure.com/scalesetpriority","operator":"Equal","value":"spot","effect":"NoSchedule"}]'
readonly AKS_SPOT_POD_SPEC_PATCH="{\"spec\":{\"template\":{\"spec\":{\"tolerations\":${AKS_SPOT_TOLERATIONS}}}}}"

# Args: namespace, deployment...
# Returns: 0 - every deployment patched and rolled out
#          1 - a patch failed or a deployment did not finish rolling out
_aks_spot::tolerate_deployments() {
  local namespace=$1
  shift
  local deployment
  for deployment in "$@"; do
    kubectl patch "deployment/${deployment}" -n "${namespace}" --type=merge -p "${AKS_SPOT_POD_SPEC_PATCH}" || return 1
  done
  for deployment in "$@"; do
    kubectl rollout status "deployment/${deployment}" -n "${namespace}" --timeout=300s || return 1
  done
}

# Installs Tekton with the toleration before operator::install_tekton waits for the webhook, which
# then only finds the namespace and waits. The webhook requests 100m CPU, more than the system pool
# has left.
# Args: none
# Returns: 0 - Tekton applied and its deployments rolled out on the spot pool
#          1 - Tekton could not be applied or did not roll out
aks_spot::install_tekton() {
  log::info "Installing Tekton Pipelines with the AKS spot toleration"
  if ! kubectl apply -f "${TEKTON_RELEASE_URL}"; then
    log::error "Failed to apply the Tekton Pipelines release manifest"
    return 1
  fi
  _aks_spot::tolerate_deployments tekton-pipelines \
    tekton-pipelines-controller tekton-events-controller tekton-pipelines-webhook || return 1
  _aks_spot::tolerate_deployments tekton-pipelines-resolvers tekton-pipelines-remote-resolvers
}

# Moves OLM off the system pool. OLM owns the packageserver deployment and reverts direct changes,
# so its ClusterServiceVersion is patched as well. The deployment is patched directly too, in case
# OLM only applies the CSV change on the next install.
# Args: none
# Returns: 0 - OLM runs on the spot pool
#          1 - OLM could not be patched or did not finish rolling out
aks_spot::tolerate_olm() {
  log::info "Moving OLM to the AKS spot node pool"
  _aks_spot::tolerate_deployments olm olm-operator catalog-operator || return 1

  if ! kubectl patch csv packageserver -n olm --type=json \
    -p "[{\"op\":\"add\",\"path\":\"/spec/install/spec/deployments/0/spec/template/spec/tolerations\",\"value\":${AKS_SPOT_TOLERATIONS}}]"; then
    log::error "Failed to patch the OLM packageserver ClusterServiceVersion"
    return 1
  fi
  kubectl patch deployment packageserver -n olm --type=merge \
    -p "${AKS_SPOT_POD_SPEC_PATCH}" || return 1

  if ! common::poll_until \
    "kubectl get deployment packageserver -n olm -o jsonpath='{.spec.template.spec.tolerations[*].key}' | grep -q scalesetpriority" \
    60 5 "packageserver tolerates the AKS spot taint"; then
    log::error "packageserver did not pick up the AKS spot toleration"
    kubectl get csv/packageserver deployment/packageserver -n olm 2>&1 | tail -n 20 || true
    return 1
  fi
  kubectl rollout status deployment/packageserver -n olm --timeout=300s
}

# Moves the RHDH operator off the system pool. OLM copies the Subscription config into the operator
# deployment, which keeps it stable across CSV upgrades.
# Args: none
# Returns: 0 - the RHDH operator runs on the spot pool
#          1 - the operator could not be patched or did not finish rolling out
aks_spot::tolerate_rhdh_operator() {
  local operator_manager="${OPERATOR_MANAGER:-rhdh-operator}"

  log::info "Moving the RHDH operator to the AKS spot node pool"
  if ! kubectl patch subscription rhdh -n "${operator_manager}" --type=merge \
    -p "{\"spec\":{\"config\":{\"tolerations\":${AKS_SPOT_TOLERATIONS}}}}"; then
    log::error "Failed to patch the rhdh Subscription"
    return 1
  fi

  if ! common::poll_until \
    "kubectl get deployment rhdh-operator -n '${operator_manager}' -o jsonpath='{.spec.template.spec.tolerations[*].key}' | grep -q scalesetpriority" \
    60 5 "rhdh-operator tolerates the AKS spot taint"; then
    log::error "rhdh-operator did not pick up the AKS spot toleration"
    kubectl get subscription/rhdh csv deployment -n "${operator_manager}" 2>&1 | tail -n 20 || true
    return 1
  fi
  kubectl rollout status deployment/rhdh-operator -n "${operator_manager}" --timeout=300s
}
