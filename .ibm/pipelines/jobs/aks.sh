#!/bin/bash

handle_aks() {
  echo "Starting AKS deployment"
  for file in ${DIR}/cluster/aks/*.sh; do source $file; done

  export K8S_CLUSTER_ROUTER_BASE=$(kubectl get svc nginx --namespace app-routing-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  export NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  export NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"

  local url="https://${K8S_CLUSTER_ROUTER_BASE}"
  initiate_aks_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}" "${url}" 50 30
  delete_namespace "${NAME_SPACE_K8S}"

  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  initiate_rbac_aks_deployment
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}" "${rbac_rhdh_base_url}" 50 30
  delete_namespace "${NAME_SPACE_RBAC_K8S}"
}
