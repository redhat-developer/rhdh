#!/bin/bash

if [[ -n "${EKS_HELM_JOBS_SOURCED:-}" ]]; then
  return 0
fi
readonly EKS_HELM_JOBS_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/cluster/eks/eks-helm-deployment.sh
source "$DIR"/cluster/eks/eks-helm-deployment.sh
# shellcheck source=.ci/pipelines/cluster/eks/aws.sh
source "$DIR"/cluster/eks/aws.sh
# shellcheck source=.ci/pipelines/cluster/k8s/k8s-utils.sh
source "$DIR"/cluster/k8s/k8s-utils.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/http2-caddy.sh
source "$DIR"/lib/http2-caddy.sh

handle_eks_helm() {
  log::info "Starting EKS Helm deployment"

  # Note: aws_eks_verify_cluster removed in PR #3610 - cluster is pre-configured by CI environment
  # Note: aws_eks_get_cluster_info removed in PR #3610 - platform vars are now hardcoded

  export NAME_SPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"
  # WIP RHIDP-15792 Path A: enable Caddy HTTP/2 verification on this branch only.
  export ENABLE_HTTP2_CADDY_CHECK="${ENABLE_HTTP2_CADDY_CHECK:-true}"

  common::kubectl_login

  cluster_setup_k8s_helm

  EKS_INSTANCE_DOMAIN_NAME=$(aws::generate_domain_name)
  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE EKS_INSTANCE_DOMAIN_NAME

  aws::get_certificate "${EKS_INSTANCE_DOMAIN_NAME}"

  initiate_eks_helm_deployment
  aws::configure_ingress_and_dns "${NAME_SPACE}" "${RELEASE_NAME}-developer-hub" "${EKS_INSTANCE_DOMAIN_NAME}"

  if [[ "${ENABLE_HTTP2_CADDY_CHECK}" == "true" ]]; then
    http2_caddy::deploy_and_verify \
      "${NAME_SPACE}" \
      "${RELEASE_NAME}-developer-hub" \
      "rhdh-h2.${EKS_INSTANCE_DOMAIN_NAME}"
  fi

  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  aws::cleanup_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
  namespace::delete "${NAME_SPACE}"

  EKS_INSTANCE_DOMAIN_NAME=$(aws::generate_domain_name)
  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE EKS_INSTANCE_DOMAIN_NAME
  aws::get_certificate "${EKS_INSTANCE_DOMAIN_NAME}"

  initiate_rbac_eks_helm_deployment
  aws::configure_ingress_and_dns "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}-developer-hub" "${EKS_INSTANCE_DOMAIN_NAME}"
  testing::check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  aws::cleanup_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
  namespace::delete "${NAME_SPACE_RBAC}"
}
