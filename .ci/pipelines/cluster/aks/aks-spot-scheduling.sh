#!/bin/bash

if [[ -n "${AKS_SPOT_SCHEDULING_SOURCED:-}" ]]; then
  return 0
fi
readonly AKS_SPOT_SCHEDULING_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh

readonly AKS_SPOT_POLICY_FILE="${DIR}/cluster/aks/manifest/aks-spot-scheduling-policy.yaml"

# Let every new pod tolerate the AKS spot taint, so workloads created by installers we do not
# drive pod by pod can leave the small system pool. AKS refuses to remove the taint.
# Args: none
# Returns: 0 - policy applied and verified to take effect
#          1 - policy could not be applied, or did not take effect
aks_spot::enable_scheduling() {
  if ! kubectl api-resources --api-group=admissionregistration.k8s.io -o name 2> /dev/null \
    | grep -qx "mutatingadmissionpolicies.admissionregistration.k8s.io"; then
    log::error "MutatingAdmissionPolicy is not available on this cluster; the AKS jobs need Kubernetes 1.36 or newer"
    return 1
  fi

  log::info "Applying the AKS spot node scheduling policy"
  if ! kubectl apply -f "${AKS_SPOT_POLICY_FILE}"; then
    log::error "Failed to apply the AKS spot node scheduling policy"
    return 1
  fi

  # A server-side dry-run pod runs through admission, so this proves the policy is active now
  # instead of showing up as a Pending webhook 30 minutes later.
  local check_pod="aks-spot-policy-check-$$"
  local attempt
  for attempt in $(seq 1 12); do
    if kubectl run "${check_pod}" --namespace default --image=registry.k8s.io/pause:3.10 \
      --restart=Never --dry-run=server -o json 2> /dev/null \
      | jq -e '.spec.tolerations[]? | select(.key == "kubernetes.azure.com/scalesetpriority" and .value == "spot")' > /dev/null; then
      log::info "New pods tolerate the AKS spot taint"
      return 0
    fi
    log::debug "Spot scheduling policy not active yet (attempt ${attempt}/12); retrying"
    sleep 5
  done

  log::error "The AKS spot node scheduling policy did not add the toleration to a test pod"
  return 1
}
