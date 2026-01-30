#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gke-helm-deployment.sh
source "$DIR"/cluster/gke/gke-helm-deployment.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_gke_helm() {
  export NAME_SPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"

  log::info "Creating GKE SSL certificate..."
  gcloud_ssl_cert_create "$GKE_CERT_NAME" "$GKE_INSTANCE_DOMAIN_NAME" "$GOOGLE_CLOUD_PROJECT"

  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(common::base64_encode "$K8S_CLUSTER_URL")
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL

  log::info "Starting GKE Helm deployment"

  cluster_setup_k8s_helm

  initiate_gke_helm_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  namespace::delete "${NAME_SPACE}"

  initiate_rbac_gke_helm_deployment
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  namespace::delete "${NAME_SPACE_RBAC}"
}
