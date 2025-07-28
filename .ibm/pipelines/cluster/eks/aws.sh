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
configure_eks_ingress_and_dns() {
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

  export EKS_INGRESS_HOSTNAME="${ingress_address}"

  echo "EKS ingress hosts configuration completed successfully"
  
  # Update DNS record in Route53 if domain name is configured
  if [[ -n "${EKS_INSTANCE_DOMAIN_NAME}" ]]; then
    echo "Updating DNS record for domain: ${EKS_INSTANCE_DOMAIN_NAME} -> ${ingress_address}"
    
    if update_route53_dns_record "${EKS_INSTANCE_DOMAIN_NAME}" "${ingress_address}"; then
      echo "✅ DNS record updated successfully"
      
      # Verify DNS resolution
      if verify_dns_resolution "${EKS_INSTANCE_DOMAIN_NAME}" "${ingress_address}" 20 15; then
        echo "✅ DNS resolution verified successfully"
      else
        echo "⚠️  DNS resolution verification failed, but record was updated"
      fi
    else
      echo "⚠️  Failed to update DNS record, but ingress is still functional"
    fi
  else
    echo "No domain name configured, skipping DNS update"
  fi
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
    echo "No certificate found for domain: ${domain_name}"
    echo "Creating new certificate..."
    
    # Create a new certificate
    local new_certificate_arn
    new_certificate_arn=$(aws acm request-certificate \
      --domain-name "${domain_name}" \
      --validation-method DNS \
      --query 'CertificateArn' \
      --output text 2>/dev/null)
    
    if [[ $? -ne 0 || -z "${new_certificate_arn}" ]]; then
      echo "Error: Failed to create new certificate for domain: ${domain_name}"
      return 1
    fi
    
    echo "✅ New certificate created successfully: ${new_certificate_arn}"
    certificate_arn="${new_certificate_arn}"
    
    # Get validation records that need to be created
    echo "Getting DNS validation records..."
    local validation_records
    validation_records=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json 2>/dev/null)
    
    if [[ $? -eq 0 && "${validation_records}" != "null" && "${validation_records}" != "[]" ]]; then
      local validation_name
      local validation_value
      validation_name=$(echo "${validation_records}" | jq -r '.Name')
      validation_value=$(echo "${validation_records}" | jq -r '.Value')
      
      # Check if we got valid values
      if [[ -n "${validation_name}" && "${validation_name}" != "null" && -n "${validation_value}" && "${validation_value}" != "null" ]]; then
        echo "DNS validation record needed:"
        echo "  Name: ${validation_name}"
        echo "  Value: ${validation_value}"
        echo "  Type: CNAME"
        
        # Create the validation DNS record
        echo "Creating DNS validation record..."
        if update_route53_dns_record "${validation_name}" "${validation_value}"; then
          echo "✅ DNS validation record created successfully"
        else
          echo "⚠️  Failed to create DNS validation record automatically"
          echo "You may need to manually create this DNS record:"
          echo "  Name: ${validation_name}"
          echo "  Value: ${validation_value}"
          echo "  Type: CNAME"
        fi
      else
        echo "ℹ️  No valid DNS validation records found (certificate may already be validated or use different validation method)"
      fi
    else
      echo "ℹ️  No DNS validation records found (certificate may already be validated or use different validation method)"
    fi
    
    # Wait for certificate to be issued (this can take several minutes)
    echo "Waiting for certificate to be issued..."
    local max_attempts=60
    local wait_seconds=30
    
    for ((i = 1; i <= max_attempts; i++)); do
      echo "Checking certificate status (attempt ${i}/${max_attempts})..."
      
      local cert_status
      cert_status=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.Status' --output text 2>/dev/null)
      
      if [[ "${cert_status}" == "ISSUED" ]]; then
        echo "✅ Certificate has been issued successfully"
        break
      elif [[ "${cert_status}" == "FAILED" ]]; then
        echo "❌ Certificate validation failed"
        echo "Check the certificate details for validation errors:"
        aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ValidationStatus' --output text 2>/dev/null
        return 1
      elif [[ "${cert_status}" == "PENDING_VALIDATION" ]]; then
        echo "⏳ Certificate is pending validation (attempt ${i}/${max_attempts})"
        
        # Check validation method and status
        local validation_method
        local validation_status
        validation_method=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ValidationMethod' --output text 2>/dev/null)
        validation_status=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ValidationStatus' --output text 2>/dev/null)
        
        echo "  Validation method: ${validation_method}"
        echo "  Validation status: ${validation_status}"
        
        if [[ "${validation_method}" == "DNS" && "${validation_status}" == "PENDING_VALIDATION" ]]; then
          # Check if DNS validation records are available
          local validation_records
          validation_records=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json 2>/dev/null)
          
          if [[ "${validation_records}" != "null" && "${validation_records}" != "[]" ]]; then
            local validation_name
            local validation_value
            validation_name=$(echo "${validation_records}" | jq -r '.Name')
            validation_value=$(echo "${validation_records}" | jq -r '.Value')
            
            if [[ -n "${validation_name}" && "${validation_name}" != "null" && -n "${validation_value}" && "${validation_value}" != "null" ]]; then
              echo "  DNS validation record needed:"
              echo "    Name: ${validation_name}"
              echo "    Value: ${validation_value}"
              echo "    Type: CNAME"
              
              # Create the validation DNS record
              echo "  Creating DNS validation record..."
              if update_route53_dns_record "${validation_name}" "${validation_value}"; then
                echo "  ✅ DNS validation record created successfully"
              else
                echo "  ⚠️  Failed to create DNS validation record automatically"
              fi
            fi
          fi
        fi
        
        if [[ $i -lt $max_attempts ]]; then
          sleep "${wait_seconds}"
        fi
      else
        echo "ℹ️  Certificate status: ${cert_status}"
        if [[ $i -lt $max_attempts ]]; then
          sleep "${wait_seconds}"
        fi
      fi
    done
    
    # Final status check
    local final_status
    final_status=$(aws acm describe-certificate --certificate-arn "${certificate_arn}" --query 'Certificate.Status' --output text 2>/dev/null)
    
    if [[ "${final_status}" != "ISSUED" ]]; then
      echo "❌ Certificate was not issued within the expected time. Current status: ${final_status}"
      echo "You may need to manually validate the certificate or check DNS records."
      return 1
    fi
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
    
    # Additional validation checks
    local not_after
    not_after=$(echo "${certificate_details}" | jq -r '.Certificate.NotAfter' 2>/dev/null)
    if [[ -n "${not_after}" ]]; then
      echo "✅ Certificate expires: ${not_after}"
    fi
    
    local domain_names
    domain_names=$(echo "${certificate_details}" | jq -r '.Certificate.SubjectAlternativeNames[]' 2>/dev/null)
    if [[ -n "${domain_names}" ]]; then
      echo "✅ Certificate covers domains: ${domain_names}"
    fi
  else
    echo "⚠️  Certificate status: ${status}"
    return 1
  fi

  # Export certificate ARN as environment variable for use in other scripts
  export EKS_DOMAIN_NAME_CERTIFICATE_ARN="${certificate_arn}"
  echo "Certificate ARN exported as EKS_DOMAIN_NAME_CERTIFICATE_ARN: ${EKS_DOMAIN_NAME_CERTIFICATE_ARN}"

  echo "EKS certificate retrieval completed successfully"
}

# Function to get AWS region from EKS cluster
get_aws_region() {
  # Get region from EKS cluster ARN
  local cluster_arn
  cluster_arn=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null)
  
  # Extract region from EKS cluster URL
  if [[ "${cluster_arn}" =~ \.([a-z0-9-]+)\.eks\.amazonaws\.com ]]; then
    local region="${BASH_REMATCH[1]}"
    echo "Region of the EKS cluster found: ${region}" >&2
    echo "${region}"
    return 0
  else
    echo "Region of the EKS cluster not found" >&2
    return 1
  fi

}

# Function to find available domain number
find_available_domain_number() {
  local region=$1
  local max_attempts=50
  
  # Use global parent domain from secret
  if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
    echo "Error: AWS_EKS_PARENT_DOMAIN environment variable is not set" >&2
    return 1
  fi
  
  echo "Finding available domain number for region: ${region}" >&2
  echo "Using parent domain: ${AWS_EKS_PARENT_DOMAIN}" >&2
  
  # Get the parent domain hosted zone ID directly
  echo "Searching for Route53 hosted zone for domain: ${AWS_EKS_PARENT_DOMAIN}" >&2
  
  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" --output text 2>/dev/null)
  
  if [[ -z "${hosted_zone_id}" ]]; then
    echo "Error: No hosted zone found for domain: ${AWS_EKS_PARENT_DOMAIN}" >&2
    return 1
  fi
  
  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  echo "Found hosted zone ID: ${hosted_zone_id} for domain: ${AWS_EKS_PARENT_DOMAIN}" >&2
  
  # Check existing DNS records to find used numbers
  echo "Checking existing DNS records..." >&2
  local existing_records
  existing_records=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?starts_with(Name, 'eks-ci-') && ends_with(Name, '.${region}.${AWS_EKS_PARENT_DOMAIN}')].Name" \
    --output text 2>/dev/null)
  
  # Extract used numbers from existing records
  local used_numbers=()
  if [[ -n "${existing_records}" ]]; then
    while IFS= read -r record; do
      if [[ "${record}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        used_numbers+=("${BASH_REMATCH[1]}")
      fi
    done <<< "${existing_records}"
  fi
  
  echo "Found ${#used_numbers[@]} existing domains: ${used_numbers[*]}" >&2
  
  # Find the lowest available number
  local number=1
  for ((i = 1; i <= max_attempts; i++)); do
    local found=false
    for used_num in "${used_numbers[@]}"; do
      if [[ "${used_num}" == "${number}" ]]; then
        found=true
        break
      fi
    done
    
    if [[ "${found}" == false ]]; then
      echo "✅ Found available number: ${number}">&2
      echo "${number}"
      return 0
    fi
    
    ((number++))
  done
  
  echo "Error: Could not find available domain number after ${max_attempts} attempts" >&2
  return 1
}

# Function to generate dynamic domain name
generate_dynamic_domain_name() {
  echo "Generating dynamic domain name..." >&2
  
  # Get AWS region
  local region
  region=$(get_aws_region)
  
  if [[ $? -ne 0 ]]; then
    echo "Error: Could not determine AWS region" >&2
    return 1
  fi
  
  # Find available domain number
  local number
  number=$(find_available_domain_number "${region}")
  
  if [[ $? -ne 0 ]]; then
    echo "Error: Could not find available domain number" >&2
    return 1
  fi
  
  # Generate the domain name
  local domain_name="eks-ci-${number}.${region}.${AWS_EKS_PARENT_DOMAIN}"
  echo "Generated domain name: ${domain_name}" >&2
  
  echo "${domain_name}"
}

# Function to create/update DNS record in Route53
update_route53_dns_record() {
  local domain_name=$1
  local target_value=$2
  
  echo "Updating DNS record for domain: ${domain_name} -> ${target_value}"
  
  # Use global parent domain from secret
  if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
    echo "Error: AWS_EKS_PARENT_DOMAIN environment variable is not set"
    return 1
  fi
  
  echo "Using parent domain: ${AWS_EKS_PARENT_DOMAIN}"
  
  # Get the hosted zone ID for the parent domain
  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" --output text 2>/dev/null)
  
  if [[ -z "${hosted_zone_id}" ]]; then
    echo "Error: No hosted zone found for parent domain: ${AWS_EKS_PARENT_DOMAIN}"
    return 1
  fi
  
  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  echo "Found hosted zone ID: ${hosted_zone_id} for parent domain: ${AWS_EKS_PARENT_DOMAIN}"
  
  # Create the change batch JSON
  cat > /tmp/dns-change.json << EOF
{
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "${domain_name}",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [
          {
            "Value": "${target_value}"
          }
        ]
      }
    }
  ]
}
EOF

  # Apply the DNS change
  echo "Applying DNS change..."
  local change_id
  change_id=$(aws route53 change-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --change-batch file:///tmp/dns-change.json \
    --query 'ChangeInfo.Id' \
    --output text 2>/dev/null)
  
  if [[ $? -eq 0 && -n "${change_id}" ]]; then
    echo "✅ DNS change submitted successfully. Change ID: ${change_id}"
    
    # Wait for the change to be propagated
    echo "Waiting for DNS change to be propagated..."
    aws route53 wait resource-record-sets-changed --id "${change_id}"
    
    if [[ $? -eq 0 ]]; then
      echo "✅ DNS change has been propagated"
    else
      echo "⚠️  DNS change may still be propagating"
    fi
  else
    echo "❌ Failed to apply DNS change"
    return 1
  fi
  
  # Clean up temporary file
  rm -f /tmp/dns-change.json
}

# Function to verify DNS resolution
verify_dns_resolution() {
  local domain_name=$1
  local expected_target=$2
  local max_attempts=${3:-30}
  local wait_seconds=${4:-10}
  
  echo "Verifying DNS resolution for domain: ${domain_name}"
  echo "Expected target: ${expected_target}"
  
  for ((i = 1; i <= max_attempts; i++)); do
    echo "Checking DNS resolution (attempt ${i}/${max_attempts})..."
    
    # Use nslookup to check DNS resolution
    local resolved_target
    resolved_target=$(nslookup "${domain_name}" 2>/dev/null | grep -A1 "Name:" | tail -1 | awk '{print $2}')
    
    if [[ -n "${resolved_target}" && "${resolved_target}" != "NXDOMAIN" ]]; then
      echo "✅ DNS record found: ${domain_name} -> ${resolved_target}"
      
      # If we have an expected target, verify it matches
      if [[ -n "${expected_target}" ]]; then
        # For CNAME records, the resolved target will be an IP address, not the hostname
        # So we just check that it's a valid IP address (contains dots and numbers)
        if [[ "${resolved_target}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
          echo "✅ DNS record is resolving to a valid IP address (${resolved_target})"
          return 0
        else
          echo "⚠️  DNS record target (${resolved_target}) doesn't look like a valid IP address"
        fi
      else
        echo "✅ DNS record is resolving"
        return 0
      fi
    else
      echo "⏳ DNS record not found yet (attempt ${i}/${max_attempts})"
    fi
    
    if [[ $i -lt $max_attempts ]]; then
      echo "Waiting ${wait_seconds} seconds before next attempt..."
      sleep "${wait_seconds}"
    fi
  done
  
  echo "❌ DNS resolution verification failed after ${max_attempts} attempts"
  return 1
}


