#!/bin/bash

# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/cluster/eks/eks-operator-deployment.sh
source "$DIR"/cluster/eks/eks-operator-deployment.sh
# shellcheck source=.ibm/pipelines/cluster/k8s/k8s-utils.sh
source "$DIR"/cluster/k8s/k8s-utils.sh
# shellcheck source=.ibm/pipelines/cluster/eks/aws.sh
source "$DIR"/cluster/eks/aws.sh

handle_eks_operator() {
  echo "Starting EKS Operator deployment"

  # Verify EKS cluster connectivity
  aws_eks_verify_cluster

  # Get cluster information
  aws_eks_get_cluster_info

  # Generate dynamic domain name
  echo "Generating dynamic domain name..."
  local dynamic_domain
  dynamic_domain=$(generate_dynamic_domain_name)
  
  if [[ $? -ne 0 ]]; then
    echo "Error: Failed to generate dynamic domain name, using fallback"
    export EKS_INSTANCE_DOMAIN_NAME="eks-ci-fallback.${AWS_EKS_PARENT_DOMAIN}"
  else
    export EKS_INSTANCE_DOMAIN_NAME="${dynamic_domain}"
  fi

  echo "Using domain name: ${EKS_INSTANCE_DOMAIN_NAME}"

  K8S_CLUSTER_ROUTER_BASE=$EKS_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE

  NAME_SPACE="showcase-k8s-ci-nightly"
  NAME_SPACE_RBAC="showcase-rbac-k8s-ci-nightly"
  export NAME_SPACE NAME_SPACE_RBAC

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL OCM_CLUSTER_URL

  re_create_k8s_service_account_and_get_token

  cluster_setup_k8s_operator

  prepare_operator "3"

  get_eks_certificate "${K8S_CLUSTER_ROUTER_BASE}"

  initiate_eks_operator_deployment "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  configure_eks_ingress_and_dns "${NAME_SPACE}" "dh-ingress"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_eks_deployment "${NAME_SPACE}"

  initiate_rbac_eks_operator_deployment "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  configure_eks_ingress_and_dns "${NAME_SPACE_RBAC}" "dh-ingress"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}" 50 30
  cleanup_eks_deployment "${NAME_SPACE_RBAC}"
} 