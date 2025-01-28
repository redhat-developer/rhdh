#!/bin/bash

set -e
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # logs timestamp for every cmd.

# Define log file names and directories.
LOGFILE="test-log"
export DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERALL_RESULT=0

JOB_NAME=periodic-aks

# Define a cleanup function to be executed upon script exit.
# shellcheck disable=SC2317
cleanup() {
  echo "Cleaning up before exiting"
  if [[ "$JOB_NAME" == *aks* && "${OPENSHIFT_CI}" == "true" ]]; then
    # If the job is for Azure Kubernetes Service (AKS), stop the AKS cluster.
    az_aks_stop "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
  fi
  rm -rf ~/tmpbin
}

trap cleanup EXIT INT ERR

SCRIPTS=(
    "env_variables.sh"
    "utils.sh"
    "jobs/aks.sh"
    "jobs/gke.sh"
    "jobs/main.sh"
    "jobs/operator.sh"
    "jobs/periodic.sh"
)

# Source each script dynamically
for SCRIPT in "${SCRIPTS[@]}"; do
    source "${DIR}/${SCRIPT}"
    echo "Loaded ${SCRIPT}"
done

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

  case "$JOB_NAME" in
    *aks*)
      echo "Calling handle_aks"
      handle_aks
      ;;
    *gke*)
      echo "Calling handle_gke"
      handle_gke
      ;;
    *operator*)
      echo "Calling Operator"
      handle_operator
      ;;
    *periodic*)
      echo "Calling handle_periodic"
      handle_nightly
      ;;
    *pull*)
      echo "Calling handle_main"
      handle_main
      ;;
  esac

echo "Main script completed with result: ${OVERALL_RESULT}"
exit "${OVERALL_RESULT}"

}

main
