#!/bin/bash

# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/cluster/aks/aks-operator-deployment.sh
source "$DIR"/cluster/aks/aks-operator-deployment.sh

handle_aks_operator() {
  echo "Starting AKS deployment"

  export KUBECONFIG=/tmp/kubeconfig

  export K8S_CLUSTER_ROUTER_BASE=$(kubectl get svc nginx --namespace app-routing-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  export NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  export NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"

  url="https://${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_k8s_operator

  initiate_aks_operator_deployment
}