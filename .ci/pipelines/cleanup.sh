#!/bin/bash

# shellcheck source=.ci/pipelines/reporting.sh
source "$DIR"/reporting.sh
# shellcheck source=.ci/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ci/pipelines/cluster/eks/aws.sh
source "$DIR"/cluster/eks/aws.sh
# shellcheck source=.ci/pipelines/lib/log.sh
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
      *eks*)
        if [[ -n "${EKS_INSTANCE_DOMAIN_NAME:-}" ]]; then
          log::info "Calling aws::cleanup_dns_record"
          aws::cleanup_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
        fi
        ;;
    esac
  fi
  rm -rf ~/tmpbin
}
