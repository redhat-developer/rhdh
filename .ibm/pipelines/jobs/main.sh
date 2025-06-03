#!/bin/bash

handle_main() {
  echo "Configuring namespace: ${NAME_SPACE}"
  oc_login
  echo "OCP version: $(oc version)"

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  cluster_setup
  initiate_deployments
  deploy_test_backstage_provider "${NAME_SPACE}"
  # local url="https://${RELEASE_NAME}-backstage-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local url="https://$(oc get route -n "${NAME_SPACE}" -l 'app.kubernetes.io/component=backstage' -o jsonpath='{.items[0].spec.host}')"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  # local rbac_url="https://${RELEASE_NAME_RBAC}-backstage-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  local rbac_url="https://$(oc get route -n "${NAME_SPACE_RBAC}" -l 'app.kubernetes.io/component=backstage' -o jsonpath='{.items[0].spec.host}')"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"
}
