#!/bin/bash

# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/cluster/aks/aks-operator-deployment.sh
source "$DIR"/cluster/aks/aks-operator-deployment.sh
# shellcheck source=.ibm/pipelines/cluster/k8s/k8s-utils.sh
source "$DIR"/cluster/k8s/k8s-utils.sh

handle_aks_operator() {
  echo "Starting AKS Operator deployment"

  K8S_CLUSTER_ROUTER_BASE=$(kubectl get svc nginx --namespace app-routing-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_k8s_operator

  prepare_operator "3"

  initiate_aks_operator_deployment "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_aks_deployment "${NAME_SPACE}"

  initiate_rbac_aks_operator_deployment "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_aks_deployment "${NAME_SPACE_RBAC}"
}
