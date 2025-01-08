#!/bin/bash

handle_gke() {
  echo "Starting GKE deployment"
  for file in ${DIR}/cluster/gke/*.sh; do source $file; done

  export K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/GKE_CLUSTER_TOKEN)
  export K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
  export K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  export OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED

  export K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  export NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  export NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"

  url="https://${K8S_CLUSTER_ROUTER_BASE}"

  gcloud_auth "${GKE_SERVICE_ACCOUNT_NAME}" "/tmp/secrets/GKE_SERVICE_ACCOUNT_KEY"
  gcloud_gke_get_credentials "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GOOGLE_CLOUD_PROJECT}"

  export K8S_CLUSTER_URL=$(oc whoami --show-server)
  export K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')

  initiate_gke_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}" "${url}" 50 30
  delete_namespace "${NAME_SPACE_K8S}"
  initiate_rbac_gke_deployment
  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}" "${rbac_rhdh_base_url}"
  delete_namespace "${NAME_SPACE_RBAC_K8S}"
}

cleanup_gke() {
  delete_tekton_pipelines
}
