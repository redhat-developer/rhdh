#!/bin/bash

set -o errexit
set -o errtrace
set -o nounset
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # only for debugging with `set -x`

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR

export OPENSHIFT_CI="${OPENSHIFT_CI:-false}"
if [[ -z "${OPENSHIFT_CI}" || "${OPENSHIFT_CI}" == "false" ]]; then
  # NOTE: Use this file to override the environment variables for the local testing.
  echo "Sourcing env_override.local.sh"
  # shellcheck source=.ibm/pipelines/env_override.local.sh
  source "${DIR}/env_override.local.sh"
fi

echo "Sourcing env_variables.sh"
# shellcheck source=.ibm/pipelines/env_variables.sh
source "${DIR}/env_variables.sh"

echo "Sourcing reporting.sh"
# shellcheck source=.ibm/pipelines/reporting.sh
source "${DIR}/reporting.sh"
save_overall_result 0 # Initialize overall result to 0 (success).
echo "Saving platform environment variables"
save_is_openshift "${IS_OPENSHIFT}"
save_container_platform "${CONTAINER_PLATFORM}" "${CONTAINER_PLATFORM_VERSION}"

# Define a cleanup function to be executed upon script exit.
# shellcheck source=.ibm/pipelines/cleanup.sh
source "${DIR}/cleanup.sh"
trap cleanup EXIT INT ERR

echo "Sourcing utils.sh"
# shellcheck source=.ibm/pipelines/utils.sh
source "${DIR}/utils.sh"

echo "Sourcing clear-database.sh"
# shellcheck source=.ibm/pipelines/clear-database.sh
source "${DIR}/clear-database.sh"

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

  CHART_VERSION=$(get_chart_version "$CHART_MAJOR_VERSION")
  export CHART_VERSION

  case "$JOB_NAME" in
    *aks*helm*nightly*)
      echo "Sourcing aks-helm.sh"
      # shellcheck source=.ibm/pipelines/jobs/aks-helm.sh
      source "${DIR}/jobs/aks-helm.sh"
      echo "Calling handle_aks_helm"
      handle_aks_helm
      ;;
    *aks*operator*nightly*)
      echo "Sourcing aks-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/aks-operator.sh
      source "${DIR}/jobs/aks-operator.sh"
      echo "Calling handle_aks_operator"
      handle_aks_operator
      ;;
    *eks*helm*nightly*)
      echo "Sourcing eks-helm.sh"
      # shellcheck source=.ibm/pipelines/jobs/eks-helm.sh
      source "${DIR}/jobs/eks-helm.sh"
      echo "Calling handle_eks_helm"
      handle_eks_helm
      ;;
    *eks*operator*nightly*)
      echo "Sourcing eks-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/eks-operator.sh
      source "${DIR}/jobs/eks-operator.sh"
      echo "Calling handle_eks_operator"
      handle_eks_operator
      ;;
    *gke*helm*nightly*)
      echo "Sourcing gke-helm.sh"
      # shellcheck source=.ibm/pipelines/jobs/gke-helm.sh
      source "${DIR}/jobs/gke-helm.sh"
      echo "Calling handle_gke_helm"
      handle_gke_helm
      ;;
    *gke*operator*nightly*)
      echo "Sourcing gke-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/gke-operator.sh
      source "${DIR}/jobs/gke-operator.sh"
      echo "Calling handle_gke_operator"
      handle_gke_operator
      ;;
    *ocp*operator*auth-providers*nightly*)
      echo "Sourcing auth-providers.sh"
      # shellcheck source=.ibm/pipelines/jobs/auth-providers.sh
      source "${DIR}/jobs/auth-providers.sh"
      echo "Calling handle_auth_providers"
      handle_auth_providers
      ;;
    *ocp*helm*upgrade*nightly*)
      echo "Sourcing upgrade.sh"
      # shellcheck source=.ibm/pipelines/jobs/upgrade.sh
      source "${DIR}/jobs/upgrade.sh"
      echo "Calling helm upgrade"
      handle_ocp_helm_upgrade
      ;;
    *ocp*helm*nightly*)
      echo "Sourcing ocp-nightly.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-nightly.sh
      source "${DIR}/jobs/ocp-nightly.sh"
      echo "Calling handle_ocp_nightly"
      handle_ocp_nightly
      ;;
    *ocp*operator*nightly*)
      echo "Sourcing ocp-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-operator.sh
      source "${DIR}/jobs/ocp-operator.sh"
      echo "Calling handle_ocp_operator"
      handle_ocp_operator
      ;;
    *osd-gcp*helm*nightly*)
      echo "Sourcing ocp-nightly.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-nightly.sh
      source "${DIR}/jobs/ocp-nightly.sh"
      echo "Calling handle_ocp_nightly"
      handle_ocp_nightly
      ;;
    *osd-gcp*operator*nightly*)
      echo "Sourcing ocp-operator.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-operator.sh
      source "${DIR}/jobs/ocp-operator.sh"
      echo "Calling handle_ocp_operator"
      handle_ocp_operator
      ;;
    *pull*ocp*helm*)
      echo "Sourcing ocp-pull.sh"
      # shellcheck source=.ibm/pipelines/jobs/ocp-pull.sh
      source "${DIR}/jobs/ocp-pull.sh"
      echo "Calling handle_ocp_pull"
      handle_ocp_pull
      ;;
    *)
      echo "ERROR: Unknown JOB_NAME pattern: $JOB_NAME"
      echo "No matching handler found for this job type"
      save_overall_result 1
      ;;
  esac

  echo "Main script completed with result: ${OVERALL_RESULT}"
  exit "${OVERALL_RESULT}"
}

main
