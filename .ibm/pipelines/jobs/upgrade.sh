#!/bin/bash

handle_ocp_helm_upgrade() {  
  export NAME_SPACE="showcase-upgrade-nightly"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE}-postgres-external-db"
  export DEPLOYMENT_NAME="rhdh-backstage"
  export QUAY_REPO_BASE="rhdh/rhdh-hub-rhel9"
  export TAG_NAME_BASE="1.4"
  export HELM_CHART_VALUE_FILE_NAME_BASE="values_showcase_${TAG_NAME_BASE}.yaml"
  
  oc_login

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  
  cluster_setup
  initiate_upgrade_base_deployments
  
  local url="https://${RELEASE_NAME}-backstage-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  
  initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"  
  check_upgrade_and_test "${DEPLOYMENT_NAME}" "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
}