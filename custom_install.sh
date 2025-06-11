#!/bin/bash

# Set environment variables for OCI Helm chart
export HELM_REPO_NAME="oci://quay.io/rhdh/chart"
export HELM_IMAGE_NAME=""  # Empty because we're using OCI registry format
export CHART_VERSION="1.6-88-CI"
export TAG_NAME="1.6-88"
export QUAY_REPO="rhdh/rhdh-hub-rhel9"  # Correct image repository

# Set cluster configuration
export JOB_NAME="pull"
#export K8S_CLUSTER_URL="https://api.alxdq5slv4a572c9df.eastus.aroapp.io:6443"
#export K8S_CLUSTER_TOKEN="sha256~2cOuRfn16cQnYXfLlVzr7yH0aBV5KJRMfR51h2Pfki4"
export K8S_CLUSTER_URL="https://api.alxdq5slv4a572c9df.eastus.aroapp.io:6443"
export K8S_CLUSTER_TOKEN="sha256~2cOuRfn16cQnYXfLlVzr7yH0aBV5KJRMfR51h2Pfki4"

# Add OCI registry to Helm
#helm registry login quay.io

# Run the installation script
sh /Users/gustavolira/development/projects/backstage/backstage-showcase/.ibm/pipelines/openshift-ci-tests.sh
