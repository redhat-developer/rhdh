#!/bin/bash

handle_upgrade() {  
  export NAME_SPACE="showcase-upgrade-nightly"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE}-postgres-external-db"
  export DEPLOYMENT_NAME="rhdh-backstage"
  export TAG_NAME_BASE="1.4"
  export HELM_CHART_VALUE_FILE_NAME_BASE="values_showcase_${TAG_NAME_BASE}.yaml"
  
  configure_namespace "${NAME_SPACE}"

  oc_login
  echo "OCP version: $(oc version)"
  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  
  cluster_setup
  initiate_upgrade_base_deployments
  
  local url="https://${RELEASE_NAME}-backstage-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  
  initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"  
  check_upgrade_and_test "${DEPLOYMENT_NAME}" "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
}