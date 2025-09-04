#!/bin/bash

cleanup() {
  if [[ $? -ne 0 ]]; then

    echo "Exited with an error, setting OVERALL_RESULT to 1"
    save_overall_result 1
  fi
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