#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/eks/eks-helm-deployment.sh
source "$DIR"/cluster/eks/eks-helm-deployment.sh
# shellcheck source=.ibm/pipelines/cluster/eks/aws.sh
source "$DIR"/cluster/eks/aws.sh

handle_eks_helm() {
  echo "Starting EKS Helm deployment"

  # Verify EKS cluster connectivity
  aws_eks_verify_cluster

  # Get cluster information
  aws_eks_get_cluster_info

  NAME_SPACE="showcase-k8s-ci-nightly"
  NAME_SPACE_RBAC="showcase-rbac-k8s-ci-nightly"
  export NAME_SPACE NAME_SPACE_RBAC

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL OCM_CLUSTER_URL

  re_create_k8s_service_account_and_get_token

  cluster_setup_k8s_helm

  EKS_INSTANCE_DOMAIN_NAME=$(generate_dynamic_domain_name)
  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE EKS_INSTANCE_DOMAIN_NAME
  get_eks_certificate "${EKS_INSTANCE_DOMAIN_NAME}"

  initiate_eks_helm_deployment
  configure_eks_ingress_and_dns "${NAME_SPACE}" "${RELEASE_NAME}-developer-hub"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_eks_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
  delete_namespace "${NAME_SPACE}"

  EKS_INSTANCE_DOMAIN_NAME=$(generate_dynamic_domain_name)
  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE EKS_INSTANCE_DOMAIN_NAME
  get_eks_certificate "${EKS_INSTANCE_DOMAIN_NAME}"

  initiate_rbac_eks_helm_deployment
  configure_eks_ingress_and_dns "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}-developer-hub"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_eks_dns_record "${EKS_INSTANCE_DOMAIN_NAME}"
  delete_namespace "${NAME_SPACE_RBAC}"
}
