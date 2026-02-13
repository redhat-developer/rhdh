#!/bin/bash

set -o errexit
set -o errtrace
set -o nounset
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # only for debugging with `set -x`

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR

# Source logging library first before any log calls
# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

export OPENSHIFT_CI="${OPENSHIFT_CI:-false}"
if [[ -z "${OPENSHIFT_CI}" || "${OPENSHIFT_CI}" == "false" ]]; then
  # NOTE: Use this file to override the environment variables for the local testing.
  if [[ -f "${DIR}/env_override.local.sh" ]]; then
    log::debug "Sourcing env_override.local.sh"
    # shellcheck source=.ibm/pipelines/env_override.local.sh
    source "${DIR}/env_override.local.sh"
  fi
fi

log::debug "Sourcing env_variables.sh"
# shellcheck source=.ibm/pipelines/env_variables.sh
source "${DIR}/env_variables.sh"

# Rotate among 5 pairs (showcase _1.._5 and RBAC_1..RBAC_5)
result=$(($(date +%N) % 5))
case $result in
  0) override_github_app_env_with_prefix "1" ;;
  1) override_github_app_env_with_prefix "2" ;;
  2) override_github_app_env_with_prefix "3" ;;
  3) override_github_app_env_with_prefix "4" ;;
  4) override_github_app_env_with_prefix "5" ;;
esac

log::debug "Sourcing reporting.sh"
# shellcheck source=.ibm/pipelines/reporting.sh
source "${DIR}/reporting.sh"
save_overall_result 0 # Initialize overall result to 0 (success).
log::debug "Saving platform environment variables"
save_is_openshift "${IS_OPENSHIFT}"
save_container_platform "${CONTAINER_PLATFORM}" "${CONTAINER_PLATFORM_VERSION}"

# Define a cleanup function to be executed upon script exit.
# shellcheck source=.ibm/pipelines/cleanup.sh
source "${DIR}/cleanup.sh"
trap cleanup EXIT

log::debug "Sourcing utils.sh"
# shellcheck source=.ibm/pipelines/utils.sh
source "${DIR}/utils.sh"

main() {
  log::info "Log file: ${LOGFILE}"
  log::info "JOB_NAME : $JOB_NAME"

  CHART_VERSION=$(helm::get_chart_version "$CHART_MAJOR_VERSION")
  export CHART_VERSION

  case "$JOB_NAME" in
    *aks*helm*nightly*)
      log::info "Sourcing aks-helm.sh"
      # shellcheck source=.ibm/pipelines/jobs/aks-helm.sh
      source "${DIR}/jobs/aks-helm.sh"
      log::info "Calling handle_aks_helm"
      handle_aks_helm
      ;;
    *aks*operator*nightly*)
      log::info "Sourcing aks-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/aks-operator.sh
      source "${DIR}/jobs/aks-operator.sh"
      log::info "Calling handle_aks_operator"
      handle_aks_operator
      ;;
    *eks*helm*nightly*)
      log::info "Sourcing eks-helm.sh"
      # shellcheck source=.ibm/pipelines/jobs/eks-helm.sh
      source "${DIR}/jobs/eks-helm.sh"
      log::info "Calling handle_eks_helm"
      handle_eks_helm
      ;;
    *eks*operator*nightly*)
      log::info "Sourcing eks-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/eks-operator.sh
      source "${DIR}/jobs/eks-operator.sh"
      log::info "Calling handle_eks_operator"
      handle_eks_operator
      ;;
    *gke*helm*nightly*)
      log::info "Sourcing gke-helm.sh"
      # shellcheck source=.ibm/pipelines/jobs/gke-helm.sh
      source "${DIR}/jobs/gke-helm.sh"
      log::info "Calling handle_gke_helm"
      handle_gke_helm
      ;;
    *gke*operator*nightly*)
      log::info "Sourcing gke-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/gke-operator.sh
      source "${DIR}/jobs/gke-operator.sh"
      log::info "Calling handle_gke_operator"
      handle_gke_operator
      ;;
    *ocp*operator*auth-providers*nightly*)
      log::info "Sourcing auth-providers.sh"
      # shellcheck source=.ibm/pipelines/jobs/auth-providers.sh
      source "${DIR}/jobs/auth-providers.sh"
      log::info "Calling handle_auth_providers"
      handle_auth_providers
      ;;
    *ocp*helm*upgrade*nightly*)
      log::info "Sourcing upgrade.sh"
      # shellcheck source=.ibm/pipelines/jobs/upgrade.sh
      source "${DIR}/jobs/upgrade.sh"
      log::info "Calling helm upgrade"
      handle_ocp_helm_upgrade
      ;;
    *ocp*helm*nightly*)
      log::info "Sourcing ocp-nightly.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-nightly.sh
      source "${DIR}/jobs/ocp-nightly.sh"
      log::info "Calling handle_ocp_nightly"
      handle_ocp_nightly
      ;;
    *ocp*operator*nightly*)
      log::info "Sourcing ocp-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-operator.sh
      source "${DIR}/jobs/ocp-operator.sh"
      log::info "Calling handle_ocp_operator"
      handle_ocp_operator
      ;;
    *osd-gcp*helm*nightly*)
      log::info "Sourcing ocp-nightly.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-nightly.sh
      source "${DIR}/jobs/ocp-nightly.sh"
      log::info "Calling handle_ocp_nightly"
      handle_ocp_nightly
      ;;
    *osd-gcp*operator*nightly*)
      log::info "Sourcing ocp-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-operator.sh
      source "${DIR}/jobs/ocp-operator.sh"
      log::info "Calling handle_ocp_operator"
      handle_ocp_operator
      ;;
    *pull*ocp*helm*)
      log::info "Sourcing ocp-pull.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-pull.sh
      source "${DIR}/jobs/ocp-pull.sh"
      log::info "Calling handle_ocp_pull"
      handle_ocp_pull
      ;;
    *)
      log::error "Unknown JOB_NAME pattern: $JOB_NAME"
      log::warn "No matching handler found for this job type"
      save_overall_result 1
      ;;
  esac

  log::info "Main script completed with result: ${OVERALL_RESULT}"
  exit "${OVERALL_RESULT}"
}

main
