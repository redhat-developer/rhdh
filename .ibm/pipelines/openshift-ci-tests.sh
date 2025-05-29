#!/bin/bash

set -e
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # logs timestamp for every cmd.

# Define log file names and directories.
LOGFILE="test-log"
export DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERALL_RESULT=0
export CURRENT_DEPLOYMENT=0 # Counter for current deployment.
export STATUS_DEPLOYMENT_NAMESPACE # Array that holds the namespaces of deployments.
export STATUS_FAILED_TO_DEPLOY # Array that indicates if deployment failed. false = success, true = failure
export STATUS_TEST_FAILED # Array that indicates if test run failed. false = success, true = failure

# Define a cleanup function to be executed upon script exit.
# shellcheck disable=SC2317
cleanup() {
  echo "Cleaning up before exiting"
  if [[ "${OPENSHIFT_CI}" == "true" ]]; then
    # if [ -z "${PULL_NUMBER:-}" ]; then # Only for nightly jobs (when PULL_NUMBER is not set).
      echo "Sending a Slack alert with the results of the CI job."
      echo "Sourcing reporting.sh"
      # shellcheck source=.ibm/pipelines/reporting.sh
      source "${DIR}/reporting.sh"
      echo "Calling report_ci_slack_alert"
      report_ci_slack_alert
    # fi

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

main() {
  echo "Log file: ${LOGFILE}"
  echo "JOB_NAME : $JOB_NAME"

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
  exit "${OVERALL_RESULT}"

}

main
