#!/bin/bash

# These functions provide AWS utilities for EKS deployments.
# The cluster is pre-configured with required addons and load balancer.
# KUBECONFIG is provided by the test environment.

# Masking helper to avoid leaking sensitive values in logs
mask_value() {
  local value="$1"
  local visible_prefix="${2:-14}"
  local visible_suffix="${3:-0}"

  # Empty or short values -> redact fully
  if [[ -z "$value" ]]; then
    echo "***REDACTED***"
    return
  fi

  local length=${#value}
  if ((length <= visible_prefix + visible_suffix + 3)); then
    echo "***REDACTED***"
  else
    echo "${value:0:visible_prefix}...${value:length-visible_suffix:visible_suffix}"
  fi
}

# AWS configuration for deployments that need AWS services
aws_configure() {
  local cluster_region
  if [[ -n "${AWS_ACCESS_KEY_ID}" && -n "${AWS_SECRET_ACCESS_KEY}" ]]; then
    aws configure set aws_access_key_id "${AWS_ACCESS_KEY_ID}"
    aws configure set aws_secret_access_key "${AWS_SECRET_ACCESS_KEY}"
    cluster_region=$(get_cluster_aws_region)
    aws configure set default.region "${cluster_region}"
    export AWS_DEFAULT_REGION="${cluster_region}"
    export AWS_REGION="${cluster_region}"
    echo "AWS CLI configured for default region: ${cluster_region}"
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
  alb_hostname=$(kubectl get ingress -n "${namespace}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}' 2> /dev/null)

  if [[ -n "${alb_hostname}" ]]; then
    echo "${alb_hostname}"
  else
    # Fallback to service load balancer
    kubectl get svc "${service_name}" -n "${namespace}" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2> /dev/null
  fi
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
    ingress_address=$(kubectl get ingress "${ingress_name}" -n "${namespace}" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2> /dev/null)

    if [[ -n "${ingress_address}" ]]; then
      echo "Successfully retrieved ingress address"
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
    local masked_domain
    local masked_target
    masked_domain=$(mask_value "${EKS_INSTANCE_DOMAIN_NAME}")
    masked_target=$(mask_value "${ingress_address}")
    echo "Updating DNS record for domain ${masked_domain} -> target ${masked_target}"

    if update_route53_dns_record "${EKS_INSTANCE_DOMAIN_NAME}" "${ingress_address}"; then
      echo "✅ DNS record updated successfully"

      # Verify DNS resolution
      if verify_dns_resolution "${EKS_INSTANCE_DOMAIN_NAME}" "${ingress_address}" 30 15; then
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

  echo "Retrieving certificate for configured domain"

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

  # Get the cluster region
  local region
  region=$(get_cluster_aws_region)
  if [[ $? -ne 0 ]]; then
    echo "Error: Failed to get cluster AWS region"
    return 1
  fi
  echo "Using region: ${region}"

  # List certificates and find the one for our domain
  echo "Searching for certificate in AWS Certificate Manager..."
  local certificate_arn
  certificate_arn=$(aws acm list-certificates --region "${region}" --query "CertificateSummaryList[].{DomainName:DomainName,Status:Status,CertificateArn:CertificateArn}" --output json | jq -r ".[] | select(.DomainName == \"${domain_name}\") | .CertificateArn")

  if [[ -z "${certificate_arn}" ]]; then
    echo "No existing certificate found for domain"
    echo "Creating new certificate..."

    # Create a new certificate
    local new_certificate_arn
    new_certificate_arn=$(aws acm request-certificate \
      --region "${region}" \
      --domain-name "${domain_name}" \
      --validation-method DNS \
      --query 'CertificateArn' \
      --output text 2> /dev/null)

    if [[ $? -ne 0 || -z "${new_certificate_arn}" ]]; then
      echo "Error: Failed to create new certificate for domain: ${domain_name}"
      return 1
    fi

    echo "✅ New certificate created successfully"
    certificate_arn="${new_certificate_arn}"

    # Get validation records that need to be created
    echo "Getting DNS validation records..."
    local validation_records
    validation_records=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json 2> /dev/null)

    if [[ $? -eq 0 && "${validation_records}" != "null" && "${validation_records}" != "[]" ]]; then
      local validation_name
      local validation_value
      validation_name=$(echo "${validation_records}" | jq -r '.Name')
      validation_value=$(echo "${validation_records}" | jq -r '.Value')

      # Check if we got valid values
      if [[ -n "${validation_name}" && "${validation_name}" != "null" && -n "${validation_value}" && "${validation_value}" != "null" ]]; then
        echo "DNS validation record needed."

        # Create the validation DNS record
        echo "Creating DNS validation record..."
        if update_route53_dns_record "${validation_name}" "${validation_value}"; then
          echo "✅ DNS validation record created successfully"
        else
          echo "⚠️  Failed to create DNS validation record automatically"
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
      cert_status=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.Status' --output text 2> /dev/null)

      if [[ "${cert_status}" == "ISSUED" ]]; then
        echo "✅ Certificate has been issued successfully"
        break
      elif [[ "${cert_status}" == "FAILED" ]]; then
        echo "❌ Certificate validation failed"
        echo "Check the certificate details for validation errors:"
        aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ValidationStatus' --output text 2> /dev/null
        return 1
      elif [[ "${cert_status}" == "PENDING_VALIDATION" ]]; then
        echo "⏳ Certificate is pending validation (attempt ${i}/${max_attempts})"

        # Check validation method and status
        local validation_method
        local validation_status
        validation_method=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ValidationMethod' --output text 2> /dev/null)
        validation_status=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ValidationStatus' --output text 2> /dev/null)

        echo "  Validation method: ${validation_method}"
        echo "  Validation status: ${validation_status}"

        if [[ "${validation_method}" == "DNS" && "${validation_status}" == "PENDING_VALIDATION" ]]; then
          # Check if DNS validation records are available
          local validation_records
          validation_records=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json 2> /dev/null)

          if [[ "${validation_records}" != "null" && "${validation_records}" != "[]" ]]; then
            local validation_name
            local validation_value
            validation_name=$(echo "${validation_records}" | jq -r '.Name')
            validation_value=$(echo "${validation_records}" | jq -r '.Value')

            if [[ -n "${validation_name}" && "${validation_name}" != "null" && -n "${validation_value}" && "${validation_value}" != "null" ]]; then
              echo "  DNS validation record needed."
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
    final_status=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" --query 'Certificate.Status' --output text 2> /dev/null)

    if [[ "${final_status}" != "ISSUED" ]]; then
      echo "❌ Certificate was not issued within the expected time. Current status: ${final_status}"
      echo "You may need to manually validate the certificate or check DNS records."
      return 1
    fi
  fi

  echo "Found certificate ARN"

  # Get certificate details
  echo "Retrieving certificate details..."
  local certificate_details
  certificate_details=$(aws acm describe-certificate --region "${region}" --certificate-arn "${certificate_arn}" 2> /dev/null)

  if [[ $? -ne 0 ]]; then
    echo "Error: Failed to retrieve certificate details"
    return 1
  fi

  # Check if certificate is valid
  local status
  status=$(echo "${certificate_details}" | jq -r '.Certificate.Status' 2> /dev/null)

  if [[ "${status}" == "ISSUED" ]]; then
    echo "✅ Certificate is valid and issued"

    # Additional validation checks
    local not_after
    not_after=$(echo "${certificate_details}" | jq -r '.Certificate.NotAfter' 2> /dev/null)
    if [[ -n "${not_after}" ]]; then
      echo "✅ Certificate expiry retrieved"
    fi

    local domain_names
    domain_names=$(echo "${certificate_details}" | jq -r '.Certificate.SubjectAlternativeNames[]' 2> /dev/null)
    if [[ -n "${domain_names}" ]]; then
      echo "✅ Certificate SANs retrieved"
    fi
  else
    echo "⚠️  Certificate status: ${status}"
    return 1
  fi

  # Export certificate ARN as environment variable for use in other scripts
  export EKS_DOMAIN_NAME_CERTIFICATE_ARN="${certificate_arn}"
  echo "Certificate ARN exported as EKS_DOMAIN_NAME_CERTIFICATE_ARN"

  echo "EKS certificate retrieval completed successfully"
}

# Function to get AWS region from EKS cluster
get_cluster_aws_region() {
  # Get region from EKS cluster ARN
  local cluster_arn
  cluster_arn=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2> /dev/null)

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
  echo "Using parent domain from AWS_EKS_PARENT_DOMAIN " >&2

  # Get the parent domain hosted zone ID directly
  echo "Searching for Route53 hosted zone for configured parent domain" >&2

  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" --output text 2> /dev/null)

  if [[ -z "${hosted_zone_id}" ]]; then
    echo "Error: No hosted zone found for configured parent domain" >&2
    return 1
  fi

  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  echo "Found hosted zone for configured parent domain" >&2

  # Check existing DNS records to find used numbers
  echo "Checking existing DNS records in hosted zone..." >&2
  echo "Looking for records containing 'eks-ci-' in configured parent domain" >&2

  local existing_records
  existing_records=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?contains(Name, 'eks-ci-')].Name" \
    --output json 2> /dev/null)

  # Extract used numbers from existing records
  local used_numbers=()
  local seen_numbers=()
  if [[ -n "${existing_records}" ]]; then
    # Parse JSON array and process each record
    while IFS= read -r record; do
      # Remove quotes and trailing comma from JSON array elements
      record=$(echo "${record}" | sed 's/^"//; s/"$//; s/,$//')
      # More robust regex to match eks-ci-[number].[region].[parent-domain]
      if [[ "${record}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        local number="${BASH_REMATCH[1]}"
        # Check if we've already seen this number to avoid duplicates
        local already_seen=false
        for seen_num in "${seen_numbers[@]}"; do
          if [[ "${seen_num}" == "${number}" ]]; then
            already_seen=true
            break
          fi
        done
        if [[ "${already_seen}" == false ]]; then
          used_numbers+=("${number}")
          seen_numbers+=("${number}")
          echo "Detected used domain slot: ${number}" >&2
        fi
      fi
    done < <(echo "${existing_records}" | jq -r '.[]' 2> /dev/null || echo "${existing_records}" | grep -o '"[^"]*"' | sed 's/"//g')
  else
    echo "No existing records found with 'eks-ci-' pattern, will start with number 1" >&2
  fi

  # Fallback: if no records found, try getting all records and filtering locally
  if [[ ${#used_numbers[@]} -eq 0 ]]; then
    echo "Trying fallback approach - getting all records and filtering locally..." >&2
    local all_records
    all_records=$(aws route53 list-resource-record-sets \
      --hosted-zone-id "${hosted_zone_id}" \
      --query "ResourceRecordSets[].Name" \
      --output json 2> /dev/null)

    # Parse JSON array and process each record
    while IFS= read -r record; do
      # Remove quotes and trailing comma from JSON array elements
      record=$(echo "${record}" | sed 's/^"//; s/"$//; s/,$//')
      if [[ "${record}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        local number="${BASH_REMATCH[1]}"
        # Check if we've already seen this number to avoid duplicates
        local already_seen=false
        for seen_num in "${seen_numbers[@]}"; do
          if [[ "${seen_num}" == "${number}" ]]; then
            already_seen=true
            break
          fi
        done
        if [[ "${already_seen}" == false ]]; then
          used_numbers+=("${number}")
          seen_numbers+=("${number}")
          echo "Detected used domain slot (fallback): ${number}" >&2
        fi
      fi
    done < <(echo "${all_records}" | jq -r '.[]' 2> /dev/null || echo "${all_records}" | grep -o '"[^"]*"' | sed 's/"//g')
  fi

  echo "Found ${#used_numbers[@]} existing domains" >&2

  # Check each potential domain to find the first one that's actually not in use
  local number=1
  for ((i = 1; i <= max_attempts; i++)); do
    local test_domain="eks-ci-${number}.${region}.${AWS_EKS_PARENT_DOMAIN}"
    echo "Testing domain availability" >&2
    # Check if this specific domain exists in Route53 (any record type)
    local domain_exists
    domain_exists=$(aws route53 list-resource-record-sets \
      --hosted-zone-id "${hosted_zone_id}" \
      --query "ResourceRecordSets[?Name == '${test_domain}.'].{Name:Name,Type:Type}" \
      --output json 2> /dev/null)

    # If the query returns an empty array or null, the domain is available
    if [[ -z "${domain_exists}" ]] || [[ "${domain_exists}" == "[]" ]] || [[ "${domain_exists}" == "null" ]]; then
      echo "✅ Found available domain (not found in Route53)" >&2
      echo "${number}"
      return 0
    else
      echo "Domain is in use in Route53, trying next number..." >&2
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
  region=$(get_cluster_aws_region)

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
  local domain_prefix="eks-ci-${number}.${region}"
  echo "Generated dynamic domain name: ${domain_prefix}" >&2

  # Reserve the domain number by creating a placeholder DNS record
  echo "Reserving domain number ${number} by creating placeholder DNS record..." >&2
  if ! create_placeholder_dns_record "${domain_name}"; then
    echo "Error: Failed to create placeholder DNS record for domain: ${domain_prefix}" >&2
    return 1
  fi

  echo "✅ Successfully reserved domain number ${number} with placeholder record" >&2
  echo "${domain_name}"
}

# Function to create a placeholder DNS record for reserving a domain number
create_placeholder_dns_record() {
  local domain_name=$1

  # Extract the domain prefix for logging (without parent domain)
  local domain_prefix
  if [[ "${domain_name}" =~ ^(eks-ci-[0-9]+\.[a-z0-9-]+)\. ]]; then
    domain_prefix="${BASH_REMATCH[1]}"
  else
    domain_prefix="${domain_name}"
  fi

  echo "Creating placeholder DNS record to reserve domain: ${domain_prefix}" >&2

  # Use global parent domain from secret
  if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
    echo "Error: AWS_EKS_PARENT_DOMAIN environment variable is not set" >&2
    return 1
  fi

  # Get the hosted zone ID for the parent domain
  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" --output text 2> /dev/null)

  if [[ -z "${hosted_zone_id}" ]]; then
    echo "Error: No hosted zone found for configured parent domain" >&2
    return 1
  fi

  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  echo "Found hosted zone for configured parent domain" >&2

  # Create the change batch JSON for placeholder record
  cat > /tmp/placeholder-dns-change.json << EOF
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
            "Value": "localhost"
          }
        ]
      }
    }
  ]
}
EOF

  # Apply the DNS change
  echo "Applying placeholder DNS change..." >&2
  local change_id
  change_id=$(aws route53 change-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --change-batch file:///tmp/placeholder-dns-change.json \
    --query 'ChangeInfo.Id' \
    --output text 2> /dev/null)

  if [[ $? -eq 0 && -n "${change_id}" ]]; then
    echo "✅ Placeholder DNS record created successfully" >&2

    # Wait for the change to be propagated
    echo "Waiting for placeholder DNS change to be propagated..." >&2
    aws route53 wait resource-record-sets-changed --id "${change_id}"

    if [[ $? -eq 0 ]]; then
      echo "✅ Placeholder DNS change has been propagated" >&2
    else
      echo "⚠️  Placeholder DNS change may still be propagating" >&2
    fi

    # Clean up temporary file
    rm -f /tmp/placeholder-dns-change.json
    return 0
  else
    echo "❌ Failed to create placeholder DNS record" >&2
    # Clean up temporary file
    rm -f /tmp/placeholder-dns-change.json
    return 1
  fi
}

# Function to create/update DNS record in Route53
update_route53_dns_record() {
  local domain_name=$1
  local target_value=$2

  local masked_domain
  local masked_target
  masked_domain=$(mask_value "${domain_name}")
  masked_target=$(mask_value "${target_value}")
  echo "Updating DNS record for domain ${masked_domain} -> target ${masked_target}"

  # Use global parent domain from secret
  if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
    echo "Error: AWS_EKS_PARENT_DOMAIN environment variable is not set"
    return 1
  fi

  echo "Using configured parent domain"

  # Get the hosted zone ID for the parent domain
  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" --output text 2> /dev/null)

  if [[ -z "${hosted_zone_id}" ]]; then
    echo "Error: No hosted zone found for configured parent domain"
    return 1
  fi

  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  echo "Found hosted zone for configured parent domain"

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
    --output text 2> /dev/null)

  if [[ $? -eq 0 && -n "${change_id}" ]]; then
    echo "✅ DNS change submitted successfully"

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

  echo "Verifying DNS resolution for configured domain"

  for ((i = 1; i <= max_attempts; i++)); do
    echo "Checking DNS resolution (attempt ${i}/${max_attempts})..."

    # Use nslookup to check DNS resolution
    local resolved_target
    resolved_target=$(nslookup "${domain_name}" 2> /dev/null | grep -A1 "Name:" | tail -1 | awk '{print $2}')

    if [[ -n "${resolved_target}" && "${resolved_target}" != "NXDOMAIN" ]]; then
      echo "✅ DNS record found"

      # If we have an expected target, verify it matches
      if [[ -n "${expected_target}" ]]; then
        # For CNAME records, the resolved target will be an IP address, not the hostname
        # So we just check that it's a valid IP address (contains dots and numbers)
        if [[ "${resolved_target}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
          echo "✅ DNS record is resolving to a valid IP address"
          return 0
        else
          echo "⚠️  DNS record target doesn't look like a valid IP address"
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

# Function to cleanup EKS DNS records
cleanup_eks_dns_record() {
  local domain_name=$1

  echo "Cleaning up EKS DNS record"

  # Use global parent domain from secret
  if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
    echo "Error: AWS_EKS_PARENT_DOMAIN environment variable is not set" >&2
    return 1
  fi

  echo "Using configured parent domain"

  # Get the hosted zone ID for the parent domain
  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" --output text 2> /dev/null)

  if [[ -z "${hosted_zone_id}" ]]; then
    echo "Error: No hosted zone found for parent domain: ${AWS_EKS_PARENT_DOMAIN}" >&2
    return 1
  fi

  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  echo "Found hosted zone for configured parent domain"

  # Check if the DNS record exists before attempting to delete it
  echo "Checking if DNS record exists"
  local existing_record
  existing_record=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?Name == '${domain_name}.'].{Name:Name,Type:Type,TTL:TTL,ResourceRecords:ResourceRecords}" \
    --output json 2> /dev/null)

  if [[ -z "${existing_record}" ]] || [[ "${existing_record}" == "[]" ]] || [[ "${existing_record}" == "null" ]]; then
    echo "✅ DNS record does not exist, nothing to clean up"
    return 0
  fi

  echo "Found existing DNS record"

  # Extract the record details for deletion
  local record_name
  local record_type
  local record_ttl
  local record_values

  record_name=$(echo "${existing_record}" | jq -r '.[0].Name' 2> /dev/null)
  record_type=$(echo "${existing_record}" | jq -r '.[0].Type' 2> /dev/null)
  record_ttl=$(echo "${existing_record}" | jq -r '.[0].TTL' 2> /dev/null)
  record_values=$(echo "${existing_record}" | jq -r '.[0].ResourceRecords[].Value' 2> /dev/null)

  if [[ -z "${record_name}" ]] || [[ "${record_name}" == "null" ]]; then
    echo "Error: Could not extract record details from existing record" >&2
    return 1
  fi

  echo "Record details retrieved (type and TTL)"

  # Create the change batch JSON for deletion
  cat > /tmp/dns-delete.json << EOF
{
  "Changes": [
    {
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "${record_name}",
        "Type": "${record_type}",
        "TTL": ${record_ttl},
        "ResourceRecords": [
EOF

  # Add the resource records
  while IFS= read -r value; do
    if [[ -n "${value}" ]] && [[ "${value}" != "null" ]]; then
      echo "          {" >> /tmp/dns-delete.json
      echo "            \"Value\": \"${value}\"" >> /tmp/dns-delete.json
      echo "          }," >> /tmp/dns-delete.json
    fi
  done <<< "${record_values}"

  # Remove the trailing comma and close the JSON
  sed -i '$ s/,$//' /tmp/dns-delete.json
  cat >> /tmp/dns-delete.json << EOF
        ]
      }
    }
  ]
}
EOF

  # Apply the DNS deletion
  echo "Deleting DNS record..."
  local change_id
  change_id=$(aws route53 change-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --change-batch file:///tmp/dns-delete.json \
    --query 'ChangeInfo.Id' \
    --output text 2> /dev/null)

  if [[ $? -eq 0 && -n "${change_id}" ]]; then
    echo "✅ DNS record deletion submitted successfully"

    # Wait for the change to be propagated
    echo "Waiting for DNS record deletion to be propagated..."
    aws route53 wait resource-record-sets-changed --id "${change_id}"

    if [[ $? -eq 0 ]]; then
      echo "✅ DNS record deletion has been propagated"
    else
      echo "⚠️  DNS record deletion may still be propagating"
    fi
  else
    echo "❌ Failed to delete DNS record"
    return 1
  fi

  # Clean up temporary file
  rm -f /tmp/dns-delete.json

  return 0
}
