#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gke-operator-deployment.sh
source "$DIR"/cluster/gke/gke-operator-deployment.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_gke_operator() {
  export NAME_SPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"

  log::info "Creating GKE SSL certificate..."
  gcloud_ssl_cert_create "$GKE_CERT_NAME" "$GKE_INSTANCE_DOMAIN_NAME" "$GOOGLE_CLOUD_PROJECT"

  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE

  log::info "Starting GKE Operator deployment"

  cluster_setup_k8s_operator

  prepare_operator

  initiate_gke_operator_deployment "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  namespace::delete "${NAME_SPACE}"

  initiate_rbac_gke_operator_deployment "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  namespace::delete "${NAME_SPACE_RBAC}"
}
