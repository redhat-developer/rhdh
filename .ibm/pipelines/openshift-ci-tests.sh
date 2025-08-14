#!/bin/bash

# set -e  # Comentado para evitar que o script termine em caso de erro
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # logs timestamp for every cmd.

# Define log file names and directories.
LOGFILE="test-log"
export DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CURRENT_DEPLOYMENT=0 # Counter for current deployment.
export STATUS_DEPLOYMENT_NAMESPACE # Array that holds the namespaces of deployments.
export STATUS_FAILED_TO_DEPLOY # Array that indicates if deployment failed. false = success, true = failure
export STATUS_TEST_FAILED # Array that indicates if test run failed. false = success, true = failure

#echo "Sourcing reporting.sh"
# shellcheck source=.ibm/pipelines/reporting.sh
#source "${DIR}/reporting.sh"
#save_overall_result 0 # Initialize overall result to 0 (success).
export OVERALL_RESULT

# Define a cleanup function to be executed upon script exit.
# shellcheck disable=SC2317
#cleanup() {
#  if [[ $? -ne 0 ]]; then
#
#    echo "Exited with an error, setting OVERALL_RESULT to 1"
#    save_overall_result 1
#  fi
#  echo "Cleaning up before exiting"
#  if [[ "${OPENSHIFT_CI}" == "true" ]]; then
#    case "$JOB_NAME" in
#      *gke*)
#        echo "Calling cleanup_gke"
#        cleanup_gke
#        ;;
#    esac
#  fi
#  rm -rf ~/tmpbin
#}
#
#trap cleanup EXIT INT ERR

export K8S_CLUSTER_TOKEN="sha256~vkYiirc1JUSvKH9rN7vxz26Kuf5_r4DHHF1ongf4Vu0"
export K8S_CLUSTER_URL="https://api.ibcef-ef4mc-q7e.5x94.p3.openshiftapps.com:443"
export JOB_NAME="pull"
export TAG_NAME="1.6"


SCRIPTS=(
  "utils.sh"
  "env_variables.sh"
  "clear-database.sh"
)

# Source explicitly specified scripts
for SCRIPT in "${SCRIPTS[@]}"; do
  source "${DIR}/${SCRIPT}"
  echo "Loaded ${SCRIPT}"
done

# Source all scripts in jobs directory
for SCRIPT in "${DIR}"/jobs/*.sh; do
  if [ -f "$SCRIPT" ]; then
    source "$SCRIPT"
    echo "Loaded ${SCRIPT}"
  fi
done

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

  export K8S_CLUSTER_TOKEN="sha256~yuT69ON19Pvl8W9JOpRWeiTPKjEKZmzrPguCKi2LT4Q"
  export K8S_CLUSTER_URL="https://api.pdy4d-yfbjo-ds9.9ymc.p3.openshiftapps.com:443"
  export JOB_NAME="pull"
  export TAG_NAME="1.6"

  CHART_VERSION=$(get_chart_version "$CHART_MAJOR_VERSION")
  export CHART_VERSION
  detect_ocp_and_set_env_var

  case "$JOB_NAME" in
    *aks-helm*)
      echo "Calling handle_aks_helm"
      handle_aks_helm
      ;;
    *aks-operator*)
      echo "Calling handle_aks_helm"
      handle_aks_operator
      ;;
    *eks-helm*)
      echo "Calling handle_eks_helm"
      handle_eks_helm
      ;;
    *eks-operator*)
      echo "Calling handle_eks_operator"
      handle_eks_operator
      ;;
    *e2e-tests-auth-providers-nightly)
      echo "Calling handle_auth_providers"
      handle_auth_providers
      ;;
    *gke-helm*)
      echo "Calling handle_gke_helm"
      handle_gke_helm
      ;;
    *gke-operator*)
      echo "Calling handle_gke_operator"
      handle_gke_operator
      ;;
    *operator*)
      echo "Calling handle_ocp_operator"
      handle_ocp_operator
      ;;
    *upgrade*)
      echo "Calling helm upgrade"
      handle_ocp_helm_upgrade
      ;;
    *nightly*)
      echo "Calling handle_ocp_nightly"
      handle_ocp_nightly
      ;;
    *pull*)
      echo "Calling handle_ocp_pull"
      handle_ocp_pull
      ;;
    *)
      echo "ERROR: Unknown JOB_NAME pattern: $JOB_NAME"
      echo "No matching handler found for this job type"
      # save_overall_result 1  # Comentado para evitar erro quando reporting.sh não está carregado
      ;;
  esac

  echo "Main script completed with result: ${OVERALL_RESULT}"
  exit "${OVERALL_RESULT}"

}

main
