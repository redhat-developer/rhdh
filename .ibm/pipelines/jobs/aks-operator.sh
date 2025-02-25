#!/bin/bash

# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/cluster/aks/aks-operator-deployment.sh
source "$DIR"/cluster/aks/aks-operator-deployment.sh

handle_aks_operator() {
  echo "Starting AKS deployment"
  
  export K8S_CLUSTER_ROUTER_BASE=$(kubectl get svc nginx --namespace app-routing-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

  url="https://${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_k8s_operator

  initiate_aks_operator_deployment

  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"

  cleanup_aks_deployment "${NAME_SPACE}"
}