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

detect_ocp_and_set_env_var

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

  case "$JOB_NAME" in
    *aks-helm*)
      echo "Calling handle_aks_helm"
      handle_aks_helm
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
      handle_upgrade
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
exit "${OVERALL_RESULT}"

}

main
