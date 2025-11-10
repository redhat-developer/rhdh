#!/bin/bash
# Amazon Elastic Kubernetes Service (EKS) specific platform functions for RHDH CI/CD Pipeline

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source core modules
# shellcheck source=../../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"
# shellcheck source=./common.sh
source "${PIPELINES_ROOT}/modules/platform/common.sh"

# ============================================================================
# EKS Cluster Authentication
# ============================================================================

# Login to EKS cluster using AWS credentials
# Usage: login_to_eks <cluster-name> <region>
login_to_eks() {
  local cluster_name=$1
  local region=${2:-us-east-1}
  
  log_section "Logging into EKS Cluster"
  log_info "Cluster Name: ${cluster_name}"
  log_info "Region: ${region}"
  
  # Check if AWS CLI is installed
  if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed"
    return 1
  fi
  
  # Update kubeconfig for EKS
  log_info "Updating kubeconfig for EKS cluster..."
  aws eks update-kubeconfig \
    --name "${cluster_name}" \
    --region "${region}"
  
  log_success "Successfully logged into EKS cluster"
}

# ============================================================================
# EKS-Specific Ingress Configuration
# ============================================================================

# Install AWS Load Balancer Controller for EKS
# Usage: install_aws_load_balancer_controller <cluster-name> <region>
install_aws_load_balancer_controller() {
  local cluster_name=$1
  local region=${2:-us-east-1}
  
  log_section "Installing AWS Load Balancer Controller"
  
  # Check if already installed
  if kubectl get deployment -n kube-system aws-load-balancer-controller &> /dev/null; then
    log_info "AWS Load Balancer Controller is already installed"
    return 0
  fi
  
  log_info "Installing AWS Load Balancer Controller..."
  
  # Download IAM policy
  log_info "Downloading IAM policy for AWS Load Balancer Controller..."
  curl -o /tmp/iam_policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json
  
  # Create IAM policy (if it doesn't exist)
  log_info "Creating IAM policy (if not exists)..."
  aws iam create-policy \
    --policy-name AWSLoadBalancerControllerIAMPolicy \
    --policy-document file:///tmp/iam_policy.json \
    --region "${region}" 2>/dev/null || log_info "IAM policy already exists"
  
  # Create IAM service account
  log_info "Creating IAM service account for AWS Load Balancer Controller..."
  eksctl create iamserviceaccount \
    --cluster="${cluster_name}" \
    --namespace=kube-system \
    --name=aws-load-balancer-controller \
    --attach-policy-arn=arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/AWSLoadBalancerControllerIAMPolicy \
    --override-existing-serviceaccounts \
    --approve \
    --region="${region}" || log_warning "Service account creation failed or already exists"
  
  # Add helm repo
  helm repo add eks https://aws.github.io/eks-charts
  helm repo update
  
  # Install AWS Load Balancer Controller
  helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
    -n kube-system \
    --set clusterName="${cluster_name}" \
    --set serviceAccount.create=false \
    --set serviceAccount.name=aws-load-balancer-controller \
    --set region="${region}" \
    --set vpcId="${AWS_VPC_ID:-}" \
    --wait --timeout=5m
  
  log_success "AWS Load Balancer Controller installed successfully"
}

# Install NGINX Ingress Controller for EKS (alternative to ALB)
# Usage: install_nginx_ingress_eks
install_nginx_ingress_eks() {
  log_section "Installing NGINX Ingress Controller for EKS"
  
  # Check if already installed
  if kubectl get namespace ingress-nginx &> /dev/null; then
    log_info "NGINX Ingress Controller is already installed"
    return 0
  fi
  
  log_info "Installing NGINX Ingress Controller using Helm..."
  
  # Add helm repo
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
  helm repo update
  
  # Install ingress controller with EKS-specific annotations
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --create-namespace \
    --set controller.service.type=LoadBalancer \
    --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"="nlb" \
    --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-cross-zone-load-balancing-enabled"="true" \
    --wait --timeout=5m
  
  # Wait for external hostname
  log_info "Waiting for external hostname to be assigned..."
  timeout 300 bash -c '
    while true; do
      EXTERNAL_HOST=$(kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath="{.status.loadBalancer.ingress[0].hostname}" 2>/dev/null)
      if [[ -n "${EXTERNAL_HOST}" ]]; then
        echo "External hostname assigned: ${EXTERNAL_HOST}"
        break
      fi
      echo "Waiting for external hostname..."
      sleep 10
    done
  ' || log_warning "Timeout waiting for external hostname"
  
  log_success "NGINX Ingress Controller installed successfully"
}

# Get EKS ingress controller external hostname
# Usage: external_host=$(get_eks_ingress_hostname)
get_eks_ingress_hostname() {
  local external_host=$(kubectl get svc ingress-nginx-controller -n ingress-nginx \
    -o jsonpath="{.status.loadBalancer.ingress[0].hostname}" 2>/dev/null || echo "")
  
  if [[ -n "${external_host}" ]]; then
    echo "${external_host}"
    return 0
  fi
  
  log_error "Could not get EKS ingress external hostname"
  return 1
}

# ============================================================================
# EKS Storage Configuration
# ============================================================================

# Install EBS CSI Driver for EKS
# Usage: install_ebs_csi_driver <cluster-name> <region>
install_ebs_csi_driver() {
  local cluster_name=$1
  local region=${2:-us-east-1}
  
  log_section "Installing EBS CSI Driver for EKS"
  
  # Check if already installed
  if kubectl get deployment -n kube-system ebs-csi-controller &> /dev/null; then
    log_info "EBS CSI Driver is already installed"
    return 0
  fi
  
  log_info "Installing EBS CSI Driver..."
  
  # Create IAM service account for EBS CSI driver
  log_info "Creating IAM service account for EBS CSI driver..."
  eksctl create iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster "${cluster_name}" \
    --region "${region}" \
    --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
    --approve \
    --role-only \
    --role-name AmazonEKS_EBS_CSI_DriverRole || log_warning "Service account creation failed or already exists"
  
  # Install EBS CSI driver addon
  log_info "Installing EBS CSI driver addon..."
  aws eks create-addon \
    --cluster-name "${cluster_name}" \
    --addon-name aws-ebs-csi-driver \
    --service-account-role-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/AmazonEKS_EBS_CSI_DriverRole" \
    --region "${region}" 2>/dev/null || log_info "EBS CSI addon already exists"
  
  # Wait for addon to be active
  log_info "Waiting for EBS CSI driver addon to be active..."
  aws eks wait addon-active \
    --cluster-name "${cluster_name}" \
    --addon-name aws-ebs-csi-driver \
    --region "${region}" || log_warning "Timeout waiting for addon"
  
  log_success "EBS CSI Driver installed successfully"
}

# Configure EBS storage class as default
# Usage: configure_eks_storage
configure_eks_storage() {
  log_section "Configuring EKS Storage"
  
  # Create gp3 storage class (recommended for EKS)
  log_info "Creating gp3 storage class..."
  kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  encrypted: "true"
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
EOF
  
  # Remove default annotation from gp2 if it exists
  kubectl patch storageclass gp2 -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}' 2>/dev/null || true
  
  log_success "EKS storage configuration completed"
}

# ============================================================================
# EKS-Specific Add-ons
# ============================================================================

# Install Cert-Manager for EKS (for TLS certificates)
# Usage: install_cert_manager_eks
install_cert_manager_eks() {
  log_section "Installing Cert-Manager for EKS"
  
  # Check if already installed
  if kubectl get namespace cert-manager &> /dev/null; then
    log_info "Cert-Manager is already installed"
    return 0
  fi
  
  log_info "Installing Cert-Manager..."
  
  # Install cert-manager CRDs
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
  
  # Wait for cert-manager to be ready
  log_info "Waiting for Cert-Manager pods to be ready..."
  kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=5m
  
  log_success "Cert-Manager installed successfully"
}

# Install External DNS for EKS (for automatic DNS management)
# Usage: install_external_dns_eks <cluster-name> <region> <hosted-zone-id>
install_external_dns_eks() {
  local cluster_name=$1
  local region=${2:-us-east-1}
  local hosted_zone_id=${3:-}
  
  log_section "Installing External DNS for EKS"
  
  if [[ -z "${hosted_zone_id}" ]]; then
    log_warning "Hosted zone ID not provided, skipping External DNS installation"
    return 0
  fi
  
  # Check if already installed
  if kubectl get deployment -n kube-system external-dns &> /dev/null; then
    log_info "External DNS is already installed"
    return 0
  fi
  
  log_info "Installing External DNS..."
  
  # Create IAM policy for External DNS
  cat > /tmp/external-dns-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets"
      ],
      "Resource": [
        "arn:aws:route53:::hostedzone/${hosted_zone_id}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "route53:ListHostedZones",
        "route53:ListResourceRecordSets"
      ],
      "Resource": [
        "*"
      ]
    }
  ]
}
EOF
  
  aws iam create-policy \
    --policy-name ExternalDNSPolicy \
    --policy-document file:///tmp/external-dns-policy.json \
    --region "${region}" 2>/dev/null || log_info "IAM policy already exists"
  
  # Create IAM service account
  eksctl create iamserviceaccount \
    --cluster="${cluster_name}" \
    --namespace=kube-system \
    --name=external-dns \
    --attach-policy-arn=arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/ExternalDNSPolicy \
    --approve \
    --region="${region}" || log_warning "Service account creation failed or already exists"
  
  # Install External DNS
  kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-dns
  namespace: kube-system
spec:
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: external-dns
  template:
    metadata:
      labels:
        app: external-dns
    spec:
      serviceAccountName: external-dns
      containers:
      - name: external-dns
        image: registry.k8s.io/external-dns/external-dns:v0.14.0
        args:
        - --source=service
        - --source=ingress
        - --domain-filter=${DOMAIN_FILTER:-}
        - --provider=aws
        - --policy=upsert-only
        - --aws-zone-type=public
        - --registry=txt
        - --txt-owner-id=${hosted_zone_id}
EOF
  
  log_success "External DNS installed successfully"
}

# ============================================================================
# EKS Cluster Setup Functions
# ============================================================================

# Setup EKS cluster for Helm deployments
# Usage: cluster_setup_eks_helm <cluster-name> <region>
cluster_setup_eks_helm() {
  local cluster_name=$1
  local region=${2:-us-east-1}
  
  log_section "Setting up EKS Cluster for Helm Deployments"
  
  # Validate cluster access
  validate_cluster_access
  
  # Install OLM (for operator support)
  install_olm
  
  # Install Tekton Pipelines
  install_tekton_pipelines_k8s
  
  # Install EBS CSI Driver
  install_ebs_csi_driver "${cluster_name}" "${region}"
  
  # Configure storage
  configure_eks_storage
  
  # Install NGINX Ingress Controller (or AWS Load Balancer Controller)
  if [[ "${USE_AWS_LB_CONTROLLER:-false}" == "true" ]]; then
    install_aws_load_balancer_controller "${cluster_name}" "${region}"
  else
    install_nginx_ingress_eks
  fi
  
  # Install Cert-Manager (optional, for TLS)
  install_cert_manager_eks
  
  log_success "EKS cluster setup completed for Helm deployments"
}

# Setup EKS cluster for Operator deployments
# Usage: cluster_setup_eks_operator <cluster-name> <region>
cluster_setup_eks_operator() {
  local cluster_name=$1
  local region=${2:-us-east-1}
  
  log_section "Setting up EKS Cluster for Operator Deployments"
  
  # Validate cluster access
  validate_cluster_access
  
  # Install OLM
  install_olm
  
  # Install Tekton Pipelines
  install_tekton_pipelines_k8s
  
  # Install EBS CSI Driver
  install_ebs_csi_driver "${cluster_name}" "${region}"
  
  # Configure storage
  configure_eks_storage
  
  # Install NGINX Ingress Controller
  install_nginx_ingress_eks
  
  log_success "EKS cluster setup completed for Operator deployments"
}

# ============================================================================
# EKS-Specific Cleanup Functions
# ============================================================================

# Cleanup EKS-specific resources
# Usage: cleanup_eks_resources
cleanup_eks_resources() {
  log_section "Cleaning up EKS-specific resources"
  
  # Delete NGINX ingress controller (optional)
  if [[ "${CLEANUP_INGRESS:-false}" == "true" ]]; then
    log_info "Deleting NGINX Ingress Controller..."
    helm uninstall ingress-nginx -n ingress-nginx || true
    kubectl delete namespace ingress-nginx --ignore-not-found=true
  fi
  
  # Delete AWS Load Balancer Controller (optional)
  if [[ "${CLEANUP_AWS_LB_CONTROLLER:-false}" == "true" ]]; then
    log_info "Deleting AWS Load Balancer Controller..."
    helm uninstall aws-load-balancer-controller -n kube-system || true
  fi
  
  # Delete Cert-Manager (optional)
  if [[ "${CLEANUP_CERT_MANAGER:-false}" == "true" ]]; then
    log_info "Deleting Cert-Manager..."
    kubectl delete -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml --ignore-not-found=true
  fi
  
  log_success "EKS resource cleanup completed"
}

# ============================================================================
# Export Functions
# ============================================================================
export -f login_to_eks
export -f install_aws_load_balancer_controller
export -f install_nginx_ingress_eks
export -f get_eks_ingress_hostname
export -f install_ebs_csi_driver
export -f configure_eks_storage
export -f install_cert_manager_eks
export -f install_external_dns_eks
export -f cluster_setup_eks_helm
export -f cluster_setup_eks_operator
export -f cleanup_eks_resources



