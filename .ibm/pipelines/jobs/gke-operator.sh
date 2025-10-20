#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gke-operator-deployment.sh
source "$DIR"/cluster/gke/gke-operator-deployment.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

handle_gke_operator() {

  echo "Creating GKE SSL certificate..."
  gcloud_ssl_cert_create "$GKE_CERT_NAME" "$GKE_INSTANCE_DOMAIN_NAME" "$GOOGLE_CLOUD_PROJECT"

  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL

  re_create_k8s_service_account_and_get_token # Populate K8S_CLUSTER_TOKEN

  echo "Starting GKE Operator deployment"

  cluster_setup_k8s_operator

  prepare_operator

  initiate_gke_operator_deployment "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  delete_namespace "${NAME_SPACE}"

  initiate_rbac_gke_operator_deployment "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  delete_namespace "${NAME_SPACE_RBAC}"
}
