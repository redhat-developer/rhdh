#!/bin/bash

# shellcheck source=.ibm/pipelines/reporting.sh
source "$DIR"/reporting.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh

cleanup() {
  if [[ $? -ne 0 ]]; then

    echo "Exited with an error, setting OVERALL_RESULT to 1"
    save_overall_result 1
  fi
  if [[ "${OPENSHIFT_CI}" == "true" ]]; then
    echo "Cleaning up before exiting"
    case "$JOB_NAME" in
      *gke*)
        echo "Calling cleanup_gke"
        cleanup_gke
        ;;
    esac
  fi
  rm -rf ~/tmpbin
}
