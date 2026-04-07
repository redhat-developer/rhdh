#!/usr/bin/env bash

# AWS utilities for EKS deployments: Route53 DNS, ACM certificates, ingress configuration
# Dependencies: aws, kubectl, jq, nslookup, lib/log.sh
# Expects $SHARED_DIR/kubeconfig file to exist (for parsing the cluster region)

if [[ -n "${AWS_EKS_LIB_SOURCED:-}" ]]; then return 0; fi
readonly AWS_EKS_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# ==============================================================================
# Internal Helpers
# ==============================================================================

# Masking helper to avoid leaking sensitive values in logs
_aws::mask_value() {
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

# Validate that a required parameter is non-empty.
# Args: param_name, param_value [, usage_hint]
# Returns 1 with log::error if empty.
_aws::require_param() {
  local param_name="$1"
  local param_value="$2"
  local usage_hint="${3:-}"

  if [[ -z "${param_value}" ]]; then
    log::error "Missing required parameter: ${param_name}"
    [[ -n "${usage_hint}" ]] && log::info "Usage: ${usage_hint}"
    return 1
  fi
}

# Look up the Route53 hosted zone ID for AWS_EKS_PARENT_DOMAIN.
# Prints the bare zone ID (without /hostedzone/ prefix).
# Returns 1 if AWS_EKS_PARENT_DOMAIN is unset or zone is not found.
_aws::get_hosted_zone_id() {
  if [[ -z "${AWS_EKS_PARENT_DOMAIN:-}" ]]; then
    log::error "AWS_EKS_PARENT_DOMAIN environment variable is not set"
    return 1
  fi

  local hosted_zone_id
  hosted_zone_id=$(aws route53 list-hosted-zones \
    --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" \
    --output text 2> /dev/null)

  if [[ -z "${hosted_zone_id}" ]]; then
    log::error "No hosted zone found for configured parent domain"
    return 1
  fi

  # Remove the '/hostedzone/' prefix
  hosted_zone_id="${hosted_zone_id#/hostedzone/}"
  log::debug "Found hosted zone for configured parent domain"
  echo "${hosted_zone_id}"
}

# Submit a Route53 change-resource-record-sets request and wait for propagation.
# Args: hosted_zone_id, change_batch_json (raw JSON string)
# Returns 1 on failure.
_aws::apply_route53_change() {
  local hosted_zone_id="$1"
  local change_batch_json="$2"

  local tmp_file
  tmp_file=$(mktemp "${TMPDIR:-/tmp}/dns-change-XXXXXX.json")

  printf '%s\n' "${change_batch_json}" > "${tmp_file}"

  log::info "Applying Route53 change..."
  local change_id
  change_id=$(aws route53 change-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --change-batch "file://${tmp_file}" \
    --query 'ChangeInfo.Id' \
    --output text 2> /dev/null)

  local rc=$?
  rm -f "${tmp_file}"

  if [[ ${rc} -ne 0 || -z "${change_id}" ]]; then
    log::error "Failed to apply Route53 change"
    return 1
  fi

  log::success "Route53 change submitted successfully"

  log::info "Waiting for Route53 change to propagate..."
  if aws route53 wait resource-record-sets-changed --id "${change_id}"; then
    log::success "Route53 change has been propagated"
  else
    log::warn "Route53 change may still be propagating"
  fi
}

# ==============================================================================
# AWS Region Utilities
# ==============================================================================

# Get AWS region from EKS cluster endpoint URL.
# Usage: aws::get_cluster_region <cluster_url>
aws::get_cluster_region() {
  local cluster_url="${1:?Usage: aws::get_cluster_region <cluster_url>}"

  if [[ "${cluster_url}" =~ \.([a-z0-9-]+)\.eks\.amazonaws\.com ]]; then
    # BASH_REMATCH for bash, match for zsh
    local region="${BASH_REMATCH[1]:-${match[1]}}"
    log::info "Region of the EKS cluster found: ${region}"
    echo "${region}"
    return 0
  else
    log::error "Region of the EKS cluster not found"
    return 1
  fi
}

# ==============================================================================
# Route53 DNS Management
# ==============================================================================

# Find an available domain number (eks-ci-N) in the parent hosted zone.
# Args: region
_aws::find_available_domain_number() {
  local region=$1
  local max_attempts=50

  _aws::require_param "region" "${region}" || return 1

  log::info "Finding available domain number for region: ${region}"
  log::debug "Using parent domain from AWS_EKS_PARENT_DOMAIN"

  local hosted_zone_id
  hosted_zone_id=$(_aws::get_hosted_zone_id) || return 1

  # Check existing DNS records to find used numbers
  log::debug "Checking existing DNS records in hosted zone..."
  log::debug "Looking for records containing 'eks-ci-' in configured parent domain"

  local existing_records
  existing_records=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?contains(Name, 'eks-ci-')].Name" \
    --output json 2> /dev/null)

  # Extract used numbers from existing records
  local used_numbers=()
  local seen_numbers=()
  if [[ -n "${existing_records}" ]]; then
    while IFS= read -r record; do
      record=$(echo "${record}" | sed 's/^"//; s/"$//; s/,$//')
      if [[ "${record}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        local number="${BASH_REMATCH[1]}"
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
          log::debug "Detected used domain slot: ${number}"
        fi
      fi
    done < <(echo "${existing_records}" | jq -r '.[]' 2> /dev/null || echo "${existing_records}" | grep -o '"[^"]*"' | sed 's/"//g')
  else
    log::debug "No existing records found with 'eks-ci-' pattern, will start with number 1"
  fi

  # Fallback: if no records found, try getting all records and filtering locally
  if [[ ${#used_numbers[@]} -eq 0 ]]; then
    log::debug "Trying fallback approach - getting all records and filtering locally..."
    local all_records
    all_records=$(aws route53 list-resource-record-sets \
      --hosted-zone-id "${hosted_zone_id}" \
      --query "ResourceRecordSets[].Name" \
      --output json 2> /dev/null)

    while IFS= read -r record; do
      record=$(echo "${record}" | sed 's/^"//; s/"$//; s/,$//')
      if [[ "${record}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        local number="${BASH_REMATCH[1]}"
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
          log::debug "Detected used domain slot (fallback): ${number}"
        fi
      fi
    done < <(echo "${all_records}" | jq -r '.[]' 2> /dev/null || echo "${all_records}" | grep -o '"[^"]*"' | sed 's/"//g')
  fi

  log::info "Found ${#used_numbers[@]} existing domains"

  # Check each potential domain to find the first one that's actually not in use
  local number=1
  for ((i = 1; i <= max_attempts; i++)); do
    local test_domain="eks-ci-${number}.${region}.${AWS_EKS_PARENT_DOMAIN}"
    log::debug "Testing domain availability"
    local domain_exists
    domain_exists=$(aws route53 list-resource-record-sets \
      --hosted-zone-id "${hosted_zone_id}" \
      --query "ResourceRecordSets[?Name == '${test_domain}.'].{Name:Name,Type:Type}" \
      --output json 2> /dev/null)

    if [[ -z "${domain_exists}" ]] || [[ "${domain_exists}" == "[]" ]] || [[ "${domain_exists}" == "null" ]]; then
      log::success "Found available domain (not found in Route53)"
      echo "${number}"
      return 0
    else
      log::debug "Domain is in use in Route53, trying next number..."
    fi

    ((number++))
  done

  log::error "Could not find available domain number after ${max_attempts} attempts"
  return 1
}

# Create a placeholder DNS record (CNAME -> localhost) to reserve a domain number.
# Args: domain_name
_aws::create_placeholder_dns_record() {
  local domain_name=$1

  _aws::require_param "domain_name" "${domain_name}" || return 1

  local domain_prefix
  if [[ "${domain_name}" =~ ^(eks-ci-[0-9]+\.[a-z0-9-]+)\. ]]; then
    domain_prefix="${BASH_REMATCH[1]}"
  else
    domain_prefix="${domain_name}"
  fi

  log::info "Creating placeholder DNS record to reserve domain: ${domain_prefix}"

  local hosted_zone_id
  hosted_zone_id=$(_aws::get_hosted_zone_id) || return 1

  local change_batch
  change_batch=$(
    cat << ENDJSON
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
ENDJSON
  )

  if _aws::apply_route53_change "${hosted_zone_id}" "${change_batch}"; then
    log::success "Placeholder DNS record created successfully"
    return 0
  else
    log::error "Failed to create placeholder DNS record"
    return 1
  fi
}

# Create or update a CNAME record in Route53.
# Args: domain_name, target_value
_aws::update_route53_dns_record() {
  local domain_name=$1
  local target_value=$2

  _aws::require_param "domain_name" "${domain_name}" || return 1
  _aws::require_param "target_value" "${target_value}" || return 1

  local masked_domain
  local masked_target
  masked_domain=$(_aws::mask_value "${domain_name}")
  masked_target=$(_aws::mask_value "${target_value}")
  log::info "Updating DNS record for domain ${masked_domain} -> target ${masked_target}"

  local hosted_zone_id
  hosted_zone_id=$(_aws::get_hosted_zone_id) || return 1

  local change_batch
  change_batch=$(
    cat << ENDJSON
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
ENDJSON
  )

  _aws::apply_route53_change "${hosted_zone_id}" "${change_batch}"
}

# Verify that a DNS record resolves to a valid IP address.
# Args: domain_name, expected_target, max_attempts (default: 30), wait_seconds (default: 10)
_aws::verify_dns_resolution() {
  local domain_name=$1
  local expected_target=$2
  local max_attempts=${3:-30}
  local wait_seconds=${4:-10}

  _aws::require_param "domain_name" "${domain_name}" || return 1

  log::info "Verifying DNS resolution for configured domain"

  for ((i = 1; i <= max_attempts; i++)); do
    log::debug "Checking DNS resolution (attempt ${i}/${max_attempts})..."

    local resolved_target
    resolved_target=$(nslookup "${domain_name}" 2> /dev/null | grep -A1 "Name:" | tail -1 | awk '{print $2}')

    if [[ -n "${resolved_target}" && "${resolved_target}" != "NXDOMAIN" ]]; then
      log::success "DNS record found"

      if [[ -n "${expected_target}" ]]; then
        if [[ "${resolved_target}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
          log::success "DNS record is resolving to a valid IP address"
          return 0
        else
          log::warn "DNS record target doesn't look like a valid IP address"
        fi
      else
        log::success "DNS record is resolving"
        return 0
      fi
    else
      log::debug "DNS record not found yet (attempt ${i}/${max_attempts})"
    fi

    if [[ $i -lt $max_attempts ]]; then
      log::debug "Waiting ${wait_seconds} seconds before next attempt..."
      sleep "${wait_seconds}"
    fi
  done

  log::error "DNS resolution verification failed after ${max_attempts} attempts"
  return 1
}

# Delete a DNS record from Route53.
# Args: domain_name
aws::cleanup_dns_record() {
  local domain_name=$1

  _aws::require_param "domain_name" "${domain_name}" "aws::cleanup_dns_record <domain_name>" || return 1

  log::info "Cleaning up EKS DNS record"

  local hosted_zone_id
  hosted_zone_id=$(_aws::get_hosted_zone_id) || return 1

  # Check if the DNS record exists before attempting to delete it
  log::debug "Checking if DNS record exists"
  local existing_record
  existing_record=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?Name == '${domain_name}.'].{Name:Name,Type:Type,TTL:TTL,ResourceRecords:ResourceRecords}" \
    --output json 2> /dev/null)

  if [[ -z "${existing_record}" ]] || [[ "${existing_record}" == "[]" ]] || [[ "${existing_record}" == "null" ]]; then
    log::success "DNS record does not exist, nothing to clean up"
    return 0
  fi

  log::debug "Found existing DNS record"

  # Build the DELETE change batch using jq from the existing record data
  local change_batch
  change_batch=$(echo "${existing_record}" | jq '{
    Changes: [
      {
        Action: "DELETE",
        ResourceRecordSet: .[0]
      }
    ]
  }' 2> /dev/null)

  if [[ -z "${change_batch}" || "${change_batch}" == "null" ]]; then
    log::error "Could not construct deletion request from existing record"
    return 1
  fi

  log::info "Deleting DNS record..."
  _aws::apply_route53_change "${hosted_zone_id}" "${change_batch}"
}

# ==============================================================================
# Domain Name Generation
# ==============================================================================

# Generate a dynamic domain name (eks-ci-N.region.parent_domain) and reserve it.
aws::generate_domain_name() {
  log::info "Generating dynamic domain name..."

  local region
  if ! region=$(aws::get_cluster_region "$K8S_CLUSTER_URL"); then
    log::error "Could not determine AWS region"
    return 1
  fi

  local number
  if ! number=$(_aws::find_available_domain_number "${region}"); then
    log::error "Could not find available domain number"
    return 1
  fi

  local domain_name="eks-ci-${number}.${region}.${AWS_EKS_PARENT_DOMAIN}"
  local domain_prefix="eks-ci-${number}.${region}"
  log::info "Generated dynamic domain name: ${domain_prefix}"

  # Reserve the domain number by creating a placeholder DNS record
  log::debug "Reserving domain number ${number} by creating placeholder DNS record..."
  if ! _aws::create_placeholder_dns_record "${domain_name}"; then
    log::error "Failed to create placeholder DNS record for domain: ${domain_prefix}"
    return 1
  fi

  log::success "Successfully reserved domain number ${number} with placeholder record"
  echo "${domain_name}"
}

# ==============================================================================
# ACM Certificate Management
# ==============================================================================

# Retrieve (or create) an ACM certificate for the given domain.
# Exports EKS_DOMAIN_NAME_CERTIFICATE_ARN on success.
# Args: domain_name
aws::get_certificate() {
  local domain_name=$1

  _aws::require_param "domain_name" "${domain_name}" "aws::get_certificate <domain_name>" || return 1

  log::info "Retrieving certificate for configured domain"

  if ! command -v aws &> /dev/null; then
    log::error "AWS CLI is not installed or not in PATH"
    return 1
  fi

  if ! aws sts get-caller-identity &> /dev/null; then
    log::error "AWS credentials are not configured or invalid"
    return 1
  fi

  local region
  if ! region=$(aws::get_cluster_region "$K8S_CLUSTER_URL"); then
    log::error "Failed to get cluster AWS region"
    return 1
  fi
  log::info "Using region: ${region}"

  # List certificates and find the one for our domain
  log::info "Searching for certificate in AWS Certificate Manager..."
  local certificate_arn
  certificate_arn=$(aws acm list-certificates --region "${region}" \
    --query "CertificateSummaryList[].{DomainName:DomainName,Status:Status,CertificateArn:CertificateArn}" \
    --output json | jq -r ".[] | select(.DomainName == \"${domain_name}\") | .CertificateArn")

  if [[ -z "${certificate_arn}" ]]; then
    log::info "No existing certificate found for domain"
    log::info "Creating new certificate..."

    local new_certificate_arn
    if ! new_certificate_arn=$(aws acm request-certificate \
      --region "${region}" \
      --domain-name "${domain_name}" \
      --validation-method DNS \
      --query 'CertificateArn' \
      --output text 2> /dev/null) || [[ -z "${new_certificate_arn}" ]]; then
      log::error "Failed to create new certificate for domain: ${domain_name}"
      return 1
    fi

    log::success "New certificate created successfully"
    certificate_arn="${new_certificate_arn}"

    # Get validation records that need to be created
    log::info "Getting DNS validation records..."
    local validation_records
    if validation_records=$(aws acm describe-certificate --region "${region}" \
      --certificate-arn "${certificate_arn}" \
      --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
      --output json 2> /dev/null) && [[ "${validation_records}" != "null" && "${validation_records}" != "[]" ]]; then
      local validation_name
      local validation_value
      validation_name=$(echo "${validation_records}" | jq -r '.Name')
      validation_value=$(echo "${validation_records}" | jq -r '.Value')

      if [[ -n "${validation_name}" && "${validation_name}" != "null" && -n "${validation_value}" && "${validation_value}" != "null" ]]; then
        log::info "DNS validation record needed."

        log::info "Creating DNS validation record..."
        if _aws::update_route53_dns_record "${validation_name}" "${validation_value}"; then
          log::success "DNS validation record created successfully"
        else
          log::warn "Failed to create DNS validation record automatically"
        fi
      else
        log::info "No valid DNS validation records found (certificate may already be validated or use different validation method)"
      fi
    else
      log::info "No DNS validation records found (certificate may already be validated or use different validation method)"
    fi

    # Wait for certificate to be issued
    log::info "Waiting for certificate to be issued..."
    local max_attempts=60
    local wait_seconds=30

    for ((i = 1; i <= max_attempts; i++)); do
      log::debug "Checking certificate status (attempt ${i}/${max_attempts})..."

      local cert_status
      cert_status=$(aws acm describe-certificate --region "${region}" \
        --certificate-arn "${certificate_arn}" \
        --query 'Certificate.Status' --output text 2> /dev/null)

      if [[ "${cert_status}" == "ISSUED" ]]; then
        log::success "Certificate has been issued successfully"
        break
      elif [[ "${cert_status}" == "FAILED" ]]; then
        log::error "Certificate validation failed"
        log::error "Check the certificate details for validation errors:"
        aws acm describe-certificate --region "${region}" \
          --certificate-arn "${certificate_arn}" \
          --query 'Certificate.DomainValidationOptions[0].ValidationStatus' \
          --output text 2> /dev/null
        return 1
      elif [[ "${cert_status}" == "PENDING_VALIDATION" ]]; then
        log::info "Certificate is pending validation (attempt ${i}/${max_attempts})"

        local validation_method
        local validation_status
        validation_method=$(aws acm describe-certificate --region "${region}" \
          --certificate-arn "${certificate_arn}" \
          --query 'Certificate.DomainValidationOptions[0].ValidationMethod' \
          --output text 2> /dev/null)
        validation_status=$(aws acm describe-certificate --region "${region}" \
          --certificate-arn "${certificate_arn}" \
          --query 'Certificate.DomainValidationOptions[0].ValidationStatus' \
          --output text 2> /dev/null)

        log::debug "  Validation method: ${validation_method}"
        log::debug "  Validation status: ${validation_status}"

        if [[ "${validation_method}" == "DNS" && "${validation_status}" == "PENDING_VALIDATION" ]]; then
          local validation_records
          validation_records=$(aws acm describe-certificate --region "${region}" \
            --certificate-arn "${certificate_arn}" \
            --query 'Certificate.DomainValidationOptions[0].ResourceRecord' \
            --output json 2> /dev/null)

          if [[ "${validation_records}" != "null" && "${validation_records}" != "[]" ]]; then
            local validation_name
            local validation_value
            validation_name=$(echo "${validation_records}" | jq -r '.Name')
            validation_value=$(echo "${validation_records}" | jq -r '.Value')

            if [[ -n "${validation_name}" && "${validation_name}" != "null" && -n "${validation_value}" && "${validation_value}" != "null" ]]; then
              log::info "  DNS validation record needed."
              log::info "  Creating DNS validation record..."
              if _aws::update_route53_dns_record "${validation_name}" "${validation_value}"; then
                log::success "  DNS validation record created successfully"
              else
                log::warn "  Failed to create DNS validation record automatically"
              fi
            fi
          fi
        fi

        if [[ $i -lt $max_attempts ]]; then
          sleep "${wait_seconds}"
        fi
      else
        log::info "Certificate status: ${cert_status}"
        if [[ $i -lt $max_attempts ]]; then
          sleep "${wait_seconds}"
        fi
      fi
    done

    # Final status check
    local final_status
    final_status=$(aws acm describe-certificate --region "${region}" \
      --certificate-arn "${certificate_arn}" \
      --query 'Certificate.Status' --output text 2> /dev/null)

    if [[ "${final_status}" != "ISSUED" ]]; then
      log::error "Certificate was not issued within the expected time. Current status: ${final_status}"
      log::error "You may need to manually validate the certificate or check DNS records."
      return 1
    fi
  fi

  log::info "Found certificate ARN"

  # Get certificate details
  log::info "Retrieving certificate details..."
  local certificate_details
  if ! certificate_details=$(aws acm describe-certificate --region "${region}" \
    --certificate-arn "${certificate_arn}" 2> /dev/null); then
    log::error "Failed to retrieve certificate details"
    return 1
  fi

  # Check if certificate is valid
  local status
  status=$(echo "${certificate_details}" | jq -r '.Certificate.Status' 2> /dev/null)

  if [[ "${status}" == "ISSUED" ]]; then
    log::success "Certificate is valid and issued"

    local not_after
    not_after=$(echo "${certificate_details}" | jq -r '.Certificate.NotAfter' 2> /dev/null)
    if [[ -n "${not_after}" ]]; then
      log::success "Certificate expiry retrieved"
    fi

    local domain_names
    domain_names=$(echo "${certificate_details}" | jq -r '.Certificate.SubjectAlternativeNames[]' 2> /dev/null)
    if [[ -n "${domain_names}" ]]; then
      log::success "Certificate SANs retrieved"
    fi
  else
    log::warn "Certificate status: ${status}"
    return 1
  fi

  export EKS_DOMAIN_NAME_CERTIFICATE_ARN="${certificate_arn}"
  log::info "Certificate ARN exported as EKS_DOMAIN_NAME_CERTIFICATE_ARN"

  log::success "EKS certificate retrieval completed successfully"
}

# ==============================================================================
# Ingress Configuration
# ==============================================================================

# Set up EKS ingress hosts configuration and update Route53 DNS.
# Args: namespace, ingress_name, domain_name
aws::configure_ingress_and_dns() {
  local namespace=$1
  local ingress_name=$2
  local domain_name=${3:-${EKS_INSTANCE_DOMAIN_NAME:-}}

  _aws::require_param "namespace" "${namespace}" "aws::configure_ingress_and_dns <namespace> <ingress_name> [domain_name]" || return 1
  _aws::require_param "ingress_name" "${ingress_name}" "aws::configure_ingress_and_dns <namespace> <ingress_name> [domain_name]" || return 1

  log::info "Setting up EKS ingress hosts configuration..."

  log::debug "Waiting for ingress ${ingress_name} to be available in namespace ${namespace}..."
  local max_attempts=30
  local wait_seconds=10
  local ingress_address=""

  for ((i = 1; i <= max_attempts; i++)); do
    log::debug "Attempt ${i} of ${max_attempts} to get ingress address..."

    ingress_address=$(kubectl get ingress "${ingress_name}" -n "${namespace}" \
      -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2> /dev/null)

    if [[ -n "${ingress_address}" ]]; then
      log::success "Successfully retrieved ingress address"
      break
    else
      log::debug "Ingress address not available yet, waiting ${wait_seconds} seconds..."
      sleep "${wait_seconds}"
    fi
  done

  if [[ -z "${ingress_address}" ]]; then
    log::error "Failed to get ingress address after ${max_attempts} attempts"
    return 1
  fi

  export EKS_INGRESS_HOSTNAME="${ingress_address}"

  log::success "EKS ingress hosts configuration completed successfully"

  # Update DNS record in Route53 if domain name is configured
  if [[ -n "${domain_name}" ]]; then
    local masked_domain
    local masked_target
    masked_domain=$(_aws::mask_value "${domain_name}")
    masked_target=$(_aws::mask_value "${ingress_address}")
    log::info "Updating DNS record for domain ${masked_domain} -> target ${masked_target}"

    if _aws::update_route53_dns_record "${domain_name}" "${ingress_address}"; then
      log::success "DNS record updated successfully"

      if _aws::verify_dns_resolution "${domain_name}" "${ingress_address}" 30 15; then
        log::success "DNS resolution verified successfully"
      else
        log::warn "DNS resolution verification failed, but record was updated"
      fi
    else
      log::warn "Failed to update DNS record, but ingress is still functional"
    fi
  else
    log::debug "No domain name configured, skipping DNS update"
  fi
}
