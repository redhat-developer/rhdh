#!/bin/bash

# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/cluster/aks/aks-operator-deployment.sh
source "$DIR"/cluster/aks/aks-operator-deployment.sh

handle_aks_operator() {
  echo "Starting AKS deployment"
  
  export K8S_CLUSTER_ROUTER_BASE=$(kubectl get svc nginx --namespace app-routing-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  local url="https://${K8S_CLUSTER_ROUTER_BASE}"


  cluster_setup_k8s_operator

  prepare_aks_operator

  initiate_aks_operator_deployment "${NAME_SPACE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" 50 30 20
  cleanup_aks_deployment "${NAME_SPACE}"

  initiate_rbac_aks_operator_deployment "${NAME_SPACE_RBAC}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RBAC}" "${url}" 50 30 20
  cleanup_aks_deployment "${NAME_SPACE_RBAC}"
}