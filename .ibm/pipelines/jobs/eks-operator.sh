#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/cluster/eks/eks-operator-deployment.sh
source "$DIR"/cluster/eks/eks-operator-deployment.sh
# shellcheck source=.ibm/pipelines/cluster/k8s/k8s-utils.sh
source "$DIR"/cluster/k8s/k8s-utils.sh
# shellcheck source=.ibm/pipelines/cluster/eks/aws.sh
source "$DIR"/cluster/eks/aws.sh
# shellcheck source=.ibm/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_eks_operator() {
  log::info "Starting EKS Operator deployment"

  # Note: aws_eks_verify_cluster removed in PR #3610 - cluster is pre-configured by CI environment
  # Note: aws_eks_get_cluster_info removed in PR #3610 - platform vars are now hardcoded

  export NAME_SPACE="${NAME_SPACE:-showcase-k8s-ci-nightly}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac-k8s-ci-nightly}"

  cluster_setup_k8s_operator

  prepare_operator "3"

  EKS_INSTANCE_DOMAIN_NAME=$(generate_dynamic_domain_name)
  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE EKS_INSTANCE_DOMAIN_NAME
  get_eks_certificate "${EKS_INSTANCE_DOMAIN_NAME}"

  initiate_eks_operator_deployment "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  configure_eks_ingress_and_dns "${NAME_SPACE}" "dh-ingress"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_eks_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
  cleanup_eks_deployment "${NAME_SPACE}"

  EKS_INSTANCE_DOMAIN_NAME=$(generate_dynamic_domain_name)
  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE EKS_INSTANCE_DOMAIN_NAME
  get_eks_certificate "${EKS_INSTANCE_DOMAIN_NAME}"

  initiate_rbac_eks_operator_deployment "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  configure_eks_ingress_and_dns "${NAME_SPACE_RBAC}" "dh-ingress"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC_K8S}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_eks_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
  cleanup_eks_deployment "${NAME_SPACE_RBAC}"
}
