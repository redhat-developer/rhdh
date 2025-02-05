#!/bin/bash

set -e
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # logs timestamp for every cmd.

# Define log file names and directories.
LOGFILE="test-log"
export DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERALL_RESULT=0

# Define a cleanup function to be executed upon script exit.
# shellcheck disable=SC2317
cleanup() {
  echo "Cleaning up before exiting"
  if [[ "${OPENSHIFT_CI}" == "true" ]]; then
    case "$JOB_NAME" in
      *gke*)
        echo "Calling cleanup_gke"
        cleanup_gke
        ;;
    esac
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

export K8S_CLUSTER_URL='https://api.uei2j-rwdy3-why.x1ie.p3.openshiftapps.com:443'
export K8S_CLUSTER_TOKEN=${K8S_CLUSTER_TOKEN_TEMPORARY}
export JOB_NAME=pull

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
    *nightly*)
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
