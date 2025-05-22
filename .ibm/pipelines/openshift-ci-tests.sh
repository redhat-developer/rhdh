#!/bin/bash

set -e
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # logs timestamp for every cmd.

# Define log file names and directories.
LOGFILE="test-log"
export DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERALL_RESULT=0

# Define a cleanup function to be executed upon script exit.
# shellcheck disable=SC2317
#cleanup() {
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

export K8S_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_TEMPORARY
export K8S_CLUSTER_URL='https://c111-e.us-east.containers.cloud.ibm.com:31018'

SCRIPTS=(
  "utils.sh"
  "env_variables.sh"
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

export K8S_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_TEMPORARY
export K8S_CLUSTER_URL='https://c111-e.us-east.containers.cloud.ibm.com:31018'

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

  detect_ocp_and_set_env_var

  export HELM_REPO_NAME="redhat-developer-hub"
  export HELM_IMAGE_NAME="chart"
  export HELM_CHART_URL="oci://quay.io/rhdh/${HELM_IMAGE_NAME}"

  export CHART_VERSION="1.6-91-CI"
  export CHART_VERSION_BASE="1.6-91-CI"
  export QUAY_REPO_BASE="quay.io/rhdh/rhdh-hub-rhel9"
  export TAG_NAME_BASE="1.6-91"


  case "$JOB_NAME" in
    *aks-helm*)
      echo "Calling handle_aks_helm"
      handle_aks_helm
      ;;
    *aks-operator*)
      echo "Calling handle_aks_helm"
      handle_aks_operator
      ;;
    *e2e-tests-nightly-auth-providers)
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
  esac

echo "Main script completed with result: ${OVERALL_RESULT}"
sleep 1h
exit "${OVERALL_RESULT}"

}

main
