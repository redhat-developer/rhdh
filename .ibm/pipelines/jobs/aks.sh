#!/bin/bash

handle_aks() {
  echo "Starting AKS deployment"
  for file in ${DIR}/cluster/aks/*.sh; do source $file; done

  export K8S_CLUSTER_ROUTER_BASE=$AKS_INSTANCE_DOMAIN_NAME
  export NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  export NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"

  url="https://${K8S_CLUSTER_ROUTER_BASE}"

  if oc whoami --show-server > /dev/null 2>&1; then
    echo "Using an ephemeral AKS cluster."
  else
    echo "Falling back to a long-running AKS cluster."
    export K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/AKS_CLUSTER_TOKEN)
    export K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
    export K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
    export OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED

    az_login
    az_aks_start "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
    az_aks_approuting_enable "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
    az_aks_get_credentials "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"

    export K8S_CLUSTER_URL=$(oc whoami --show-server)
    export K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
    export OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  fi

  initiate_aks_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}" "${url}" 50 30
  delete_namespace "${NAME_SPACE_K8S}"
  initiate_rbac_aks_deployment
  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}" "${rbac_rhdh_base_url}"
  delete_namespace "${NAME_SPACE_RBAC_K8S}"
}

cleanup_aks() {
  az_aks_stop "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
}
