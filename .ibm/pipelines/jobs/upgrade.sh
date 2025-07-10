#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

handle_ocp_helm_upgrade() {
  export NAME_SPACE="showcase-upgrade-nightly"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE}-postgres-external-db"
  export DEPLOYMENT_NAME="rhdh-backstage"
  export QUAY_REPO_BASE="rhdh/rhdh-hub-rhel9"
  
  # Dynamically determine the previous release version
  export TAG_NAME_BASE=$(get_previous_release_version)
  if [[ $? -ne 0 ]]; then
    echo "Failed to determine latest release version. Exiting."
    save_overall_result 1
    exit 1
  fi
  echo "Using previous release version: ${TAG_NAME_BASE}"
  
  export HELM_CHART_VALUE_FILE_NAME_BASE="values_showcase_upgrade-base.yaml"

  oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_upgrade_base_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"

  initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  check_upgrade_and_test "${DEPLOYMENT_NAME}" "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
}
