#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/aks/aks-helm-deployment.sh
source "$DIR"/cluster/aks/aks-helm-deployment.sh
# shellcheck source=.ibm/pipelines/cluster/aks/az.sh
source "$DIR"/cluster/aks/az.sh

handle_aks_helm() {
  echo "Starting AKS deployment"

  export K8S_CLUSTER_ROUTER_BASE=$(kubectl get svc nginx --namespace app-routing-system -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  export NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  export NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"

  url="https://${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_k8s_helm

  initiate_aks_helm_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}" "${url}" 50 30 50
  delete_namespace "${NAME_SPACE_K8S}"
  initiate_rbac_aks_helm_deployment
  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  initiate_rbac_aks_helm_deployment
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}" "${rbac_rhdh_base_url}" 50 30 50
  delete_namespace "${NAME_SPACE_RBAC_K8S}"
}
