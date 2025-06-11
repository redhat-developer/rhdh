#!/bin/bash

# Export the environment variables to override the defaults
export HELM_REPO_NAME="oci://quay.io/rhdh/chart"
export HELM_IMAGE_NAME=""  # Empty because we're using OCI registry format
export CHART_VERSION="1.7-90-CI"

# Call the original script
./.ibm/pipelines/openshift-ci-tests.sh "$@" 