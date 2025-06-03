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

export HELM_REPO_NAME="redhat-developer-hub"
export HELM_IMAGE_NAME="chart"
export HELM_CHART_URL="oci://quay.io/rhdh/${HELM_IMAGE_NAME}"
export CHART_VERSION="1.6-91-CI"
export CHART_VERSION_BASE="1.6-91-CI"

export QUAY_REPO_BASE="quay.io/rhdh/rhdh-hub-rhel9"
export TAG_NAME_BASE="1.6-91"

SCRIPTS=(
    "env_variables.sh"
    "clear-database.sh"
    "utils.sh"
    "jobs/aks.sh"
    "jobs/gke.sh"
    "jobs/main.sh"
    "jobs/operator.sh"
    "jobs/periodic.sh"
    "jobs/auth-providers.sh"
)

# Source each script dynamically
for SCRIPT in "${SCRIPTS[@]}"; do
    source "${DIR}/${SCRIPT}"
    echo "Loaded ${SCRIPT}"
done

export HELM_REPO_NAME="redhat-developer-hub"
export HELM_IMAGE_NAME="chart"
export HELM_CHART_URL="oci://quay.io/rhdh/${HELM_IMAGE_NAME}"

export CHART_VERSION="1.6-91-CI"
export CHART_VERSION_BASE="1.6-91-CI"

export QUAY_REPO_BASE="quay.io/rhdh/rhdh-hub-rhel9"
export TAG_NAME_BASE="1.6-91"

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

  case "$JOB_NAME" in
    *aks*)
      echo "Calling handle_aks"
      handle_aks
      ;;
    *e2e-tests-nightly-auth-providers)
      echo "Calling handle_auth_providers"
      handle_auth_providers
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
