#!/bin/bash

# shellcheck source=.ibm/pipelines/reporting.sh
source "$DIR"/reporting.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/lib/logging.sh
source "$DIR"/lib/logging.sh

cleanup() {
  if [[ $? -ne 0 ]]; then

    logging::error "Exited with an error, setting OVERALL_RESULT to 1"
    save_overall_result 1
  fi
  if [[ "${OPENSHIFT_CI}" == "true" ]]; then
    logging::info "Cleaning up before exiting"
    case "$JOB_NAME" in
      *gke*)
        logging::info "Calling cleanup_gke"
        cleanup_gke
        ;;
    esac
  fi
  rm -rf ~/tmpbin
}
