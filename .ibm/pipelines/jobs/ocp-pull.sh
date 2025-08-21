#!/bin/bash

handle_ocp_pull() {
  echo "=== STARTING OCP PULL REQUEST HANDLER ==="
  echo "Configuring namespace: ${NAME_SPACE}"
  echo "RBAC namespace: ${NAME_SPACE_RBAC}"
  
  echo "=== LOGGING INTO OPENSHIFT CLUSTER ==="
  oc_login
  echo "OCP version: $(oc version)"

  echo "=== GETTING CLUSTER ROUTER BASE ==="
  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  echo "Cluster router base: ${K8S_CLUSTER_ROUTER_BASE}"

  echo "=== INITIATING DEPLOYMENTS ==="
  initiate_deployments
  echo "=== DEPLOYING TEST BACKSTAGE CUSTOMIZATION PROVIDER ==="
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  
  echo "=== TESTING MAIN DEPLOYMENT ==="
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  echo "Main deployment URL: ${url}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  
  echo "=== TESTING RBAC DEPLOYMENT ==="
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  echo "RBAC deployment URL: ${rbac_url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
  
  echo "=== COMPLETED OCP PULL REQUEST HANDLER ==="
}
