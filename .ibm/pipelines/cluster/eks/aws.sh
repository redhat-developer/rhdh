#!/bin/bash

# These functions provide AWS utilities for EKS deployments.
# The cluster is pre-configured with required addons and load balancer.
# KUBECONFIG is provided by the test environment.

# AWS configuration for deployments that need AWS services
aws_configure() {
  if [[ -n "${AWS_ACCESS_KEY_ID}" && -n "${AWS_SECRET_ACCESS_KEY}" && -n "${AWS_DEFAULT_REGION}" ]]; then
    aws configure set aws_access_key_id "${AWS_ACCESS_KEY_ID}"
    aws configure set aws_secret_access_key "${AWS_SECRET_ACCESS_KEY}"
    aws configure set default.region "${AWS_DEFAULT_REGION}"
    echo "AWS CLI configured for region: ${AWS_DEFAULT_REGION}"
  else
    echo "AWS credentials not provided, skipping AWS CLI configuration"
  fi
}

# Get load balancer hostname from EKS cluster
aws_eks_get_load_balancer_hostname() {
  local namespace=$1
  local service_name=$2

  # Try to get the ALB hostname from the ingress
  local alb_hostname
  alb_hostname=$(kubectl get ingress -n "${namespace}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}' 2>/dev/null)

  if [[ -n "${alb_hostname}" ]]; then
    echo "${alb_hostname}"
  else
    # Fallback to service load balancer
    kubectl get svc "${service_name}" -n "${namespace}" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null
  fi
}

# Verify EKS cluster connectivity
aws_eks_verify_cluster() {
  echo "Verifying EKS cluster connectivity..."

  if ! kubectl cluster-info >/dev/null 2>&1; then
    echo "Error: Cannot connect to EKS cluster. Please check KUBECONFIG."
    return 1
  fi

  echo "Successfully connected to EKS cluster"
  kubectl get nodes --no-headers | wc -l | xargs echo "Number of nodes:"
}

# Get EKS cluster information
aws_eks_get_cluster_info() {
  echo "EKS Cluster Information:"
  echo "========================"

  # Get cluster version
  kubectl version --short 2>/dev/null | grep "Server Version" || echo "Server Version: Unable to determine"

  # Get node information
  echo "Node Information:"
  kubectl get nodes -o custom-columns="NAME:.metadata.name,STATUS:.status.conditions[?(@.type=='Ready')].status,ROLES:.metadata.labels.node\.kubernetes\.io/role,SPOT:.metadata.labels.kubernetes\.aws\.com/spot" 2>/dev/null || echo "Unable to get node information"

  # Get installed addons
  echo "Installed Addons:"
  kubectl get pods -A -l app.kubernetes.io/name=aws-load-balancer-controller 2>/dev/null | grep -q aws-load-balancer-controller && echo "- AWS Load Balancer Controller" || echo "- AWS Load Balancer Controller: Not found"
  kubectl get pods -A -l app.kubernetes.io/name=aws-ebs-csi-driver 2>/dev/null | grep -q aws-ebs-csi-driver && echo "- AWS EBS CSI Driver" || echo "- AWS EBS CSI Driver: Not found"
}

# Function to setup EKS ingress hosts configuration
mock_eks_ingress_hosts() {
  local namespace=$1
  local ingress_name=$2

  echo "Setting up EKS ingress hosts configuration..."

  # Wait for ingress to be available
  echo "Waiting for ingress ${ingress_name} to be available in namespace ${namespace}..."
  local max_attempts=30
  local wait_seconds=10
  local ingress_address=""

  for ((i = 1; i <= max_attempts; i++)); do
    echo "Attempt ${i} of ${max_attempts} to get ingress address..."

    # Get the ingress address dynamically
    ingress_address=$(kubectl get ingress "${ingress_name}" -n "${namespace}" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)

    if [[ -n "${ingress_address}" ]]; then
      echo "Successfully retrieved ingress address: ${ingress_address}"
      break
    else
      echo "Ingress address not available yet, waiting ${wait_seconds} seconds..."
      sleep "${wait_seconds}"
    fi
  done

  if [[ -z "${ingress_address}" ]]; then
    echo "Error: Failed to get ingress address after ${max_attempts} attempts"
    return 1
  fi

  # Get the IP address of the ingress address with retries
  echo "Resolving IP address for ${ingress_address}..."
  local ip_address=""
  local dns_max_attempts=60
  local dns_wait_seconds=10

  for ((dns_attempt = 1; dns_attempt <= dns_max_attempts; dns_attempt++)); do
    echo "DNS resolution attempt ${dns_attempt} of ${dns_max_attempts}..."

    ip_address=$(dig +short "${ingress_address}" 2>/dev/null | head -1)

    if [[ -n "${ip_address}" ]]; then
      echo "Successfully resolved IP address: ${ip_address}"
      break
    else
      echo "DNS resolution failed, waiting ${dns_wait_seconds} seconds before retry..."
      sleep "${dns_wait_seconds}"
    fi
  done

  if [[ -z "${ip_address}" ]]; then
    echo "Error: Failed to resolve IP address for ${ingress_address} after ${dns_max_attempts} attempts"
    return 1
  fi

  echo "Resolved IP address: ${ip_address}"

  # Set up hosts file to point EKS_INSTANCE_DOMAIN_NAME to the IP address
  echo "Setting up hosts file entry..."
  echo "Adding hosts file entry: ${ip_address} ${EKS_INSTANCE_DOMAIN_NAME}"
  echo "${ip_address} ${EKS_INSTANCE_DOMAIN_NAME}" | tee -a /etc/hosts > /dev/null

  # Verify the entry was added
  if grep -q "${EKS_INSTANCE_DOMAIN_NAME}" /etc/hosts; then
    echo "Successfully configured hosts file. ${EKS_INSTANCE_DOMAIN_NAME} now points to ${ip_address}"
    echo "Hosts file entry: $(grep "${EKS_INSTANCE_DOMAIN_NAME}" /etc/hosts)"
  else
    echo "Error: Failed to add hosts file entry"
    return 1
  fi

  echo "EKS ingress hosts configuration completed successfully"
}

# Function to get EKS certificate using AWS CLI
get_eks_certificate() {
  local domain_name=$1

  echo "Retrieving certificate for domain: ${domain_name}"

  # Check if AWS CLI is available
  if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed or not in PATH"
    return 1
  fi

  # Check if AWS credentials are configured
  if ! aws sts get-caller-identity &> /dev/null; then
    echo "Error: AWS credentials are not configured or invalid"
    return 1
  fi

  # List certificates and find the one for our domain
  echo "Searching for certificate in AWS Certificate Manager..."
  local certificate_arn
  certificate_arn=$(aws acm list-certificates --query "CertificateSummaryList[].{DomainName:DomainName,Status:Status,CertificateArn:CertificateArn}" --output json | jq -r ".[] | select(.DomainName == \"${domain_name}\") | .CertificateArn")

  if [[ -z "${certificate_arn}" ]]; then
    echo "No certificate found."
    return 1
  fi

  echo "Found certificate ARN: ${certificate_arn}"

  # Get certificate details
  echo "Retrieving certificate details..."
  local certificate_details
  certificate_details=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" 2>/dev/null)

  if [[ $? -ne 0 ]]; then
    echo "Error: Failed to retrieve certificate details"
    return 1
  fi

  # Check if certificate is valid
  local status
  status=$(echo "${certificate_details}" | jq -r '.Certificate.Status' 2>/dev/null)

  if [[ "${status}" == "ISSUED" ]]; then
    echo "✅ Certificate is valid and issued"
  else
    echo "⚠️  Certificate status: ${status}"
    return 1
  fi

  # Export certificate ARN as environment variable for use in other scripts
  export EKS_DOMAIN_NAME_CERTIFICATE_ARN="${certificate_arn}"
  echo "Certificate ARN exported as EKS_DOMAIN_NAME_CERTIFICATE_ARN: ${EKS_DOMAIN_NAME_CERTIFICATE_ARN}"

  echo "EKS certificate retrieval completed successfully"
}
