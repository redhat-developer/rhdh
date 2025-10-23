#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gke-helm-deployment.sh
source "$DIR"/cluster/gke/gke-helm-deployment.sh

handle_gke_helm() {

  echo "Creating GKE SSL certificate..."
  gcloud_ssl_cert_create "$GKE_CERT_NAME" "$GKE_INSTANCE_DOMAIN_NAME" "$GOOGLE_CLOUD_PROJECT"

  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE

  echo "Starting GKE Helm deployment"

  cluster_setup_k8s_helm

  initiate_gke_helm_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  delete_namespace "${NAME_SPACE}"

  initiate_rbac_gke_helm_deployment
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  delete_namespace "${NAME_SPACE_RBAC}"
}
