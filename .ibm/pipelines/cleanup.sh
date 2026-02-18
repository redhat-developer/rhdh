#!/bin/bash

# shellcheck source=.ibm/pipelines/reporting.sh
source "$DIR"/reporting.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh

cleanup() {
  if [[ $? -ne 0 ]]; then

    log::error "Exited with an error, setting OVERALL_RESULT to 1"
    save_overall_result 1
  fi
  # Write TESTS_PASSED marker to SHARED_DIR for gather-extra/must-gather optimization.
  # When present, the openshift/release post-phase steps can skip heavy artifact collection.
  if [[ "${OVERALL_RESULT:-1}" == "0" && -n "${SHARED_DIR:-}" ]]; then
    touch "${SHARED_DIR}/TESTS_PASSED"
    log::info "TESTS_PASSED marker written to ${SHARED_DIR}"
  fi

  if [[ "${OPENSHIFT_CI}" == "true" ]]; then
    log::info "Cleaning up before exiting"
    case "$JOB_NAME" in
      *gke*)
        log::info "Calling cleanup_gke"
        cleanup_gke
        ;;
    esac
  fi
  rm -rf ~/tmpbin
}
