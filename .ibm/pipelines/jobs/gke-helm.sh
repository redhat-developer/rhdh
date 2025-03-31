#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gke-helm-deployment.sh
source "$DIR"/cluster/gke/gke-helm-deployment.sh
# shellcheck source=.ibm/pipelines/cluster/k8s/k8s-utils.sh
source "$DIR"/cluster/k8s/k8s-utils.sh

handle_gke_helm() {
  echo "Starting GKE Helm deployment"

  IS_OPENSHIFT=false

  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"
  export K8S_CLUSTER_ROUTER_BASE NAME_SPACE_K8S NAME_SPACE_RBAC_K8S

  gcloud_auth "${GKE_SERVICE_ACCOUNT_NAME}" "/tmp/secrets/GKE_SERVICE_ACCOUNT_KEY"
  gcloud_gke_get_credentials "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GOOGLE_CLOUD_PROJECT}"
  gcloud_ssl_cert_create $GKE_CERT_NAME $GKE_INSTANCE_DOMAIN_NAME $GOOGLE_CLOUD_PROJECT

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL OCM_CLUSTER_URL

  re_create_k8s_service_account_and_get_token # Populate K8S_CLUSTER_TOKEN

  cluster_setup_k8s_helm

  initiate_gke_helm_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30 20
  delete_namespace "${NAME_SPACE_K8S}"

  initiate_rbac_gke_helm_deployment
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30 20
  delete_namespace "${NAME_SPACE_RBAC_K8S}"
}
