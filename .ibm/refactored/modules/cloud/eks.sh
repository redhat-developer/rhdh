#!/usr/bin/env bash
#
# AWS EKS Cloud Helper Module
# Provides AWS/EKS specific functions for deployments
#

# Guard to prevent multiple sourcing
if [[ -n "${_EKS_LOADED:-}" ]]; then
    return 0
fi
readonly _EKS_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../retry.sh"

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

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

# ============================================================================
# AWS AUTHENTICATION
# ============================================================================

aws_configure() {
    if [[ -n "${AWS_ACCESS_KEY_ID}" && -n "${AWS_SECRET_ACCESS_KEY}" ]]; then
        log_info "Configuring AWS CLI..." >&2

        aws configure set aws_access_key_id "${AWS_ACCESS_KEY_ID}"
        aws configure set aws_secret_access_key "${AWS_SECRET_ACCESS_KEY}"

        local cluster_region
        cluster_region=$(get_cluster_aws_region)

        if [[ -n "$cluster_region" ]]; then
            aws configure set default.region "${cluster_region}"
            export AWS_DEFAULT_REGION="${cluster_region}"
            export AWS_REGION="${cluster_region}"
            log_success "AWS CLI configured for region: ${cluster_region}" >&2
        else
            log_warning "Could not determine AWS region from cluster" >&2
        fi
    else
        log_warning "AWS credentials not provided, skipping AWS CLI configuration" >&2
    fi
}

# ============================================================================
# EKS CLUSTER OPERATIONS
# ============================================================================

# Get AWS region from EKS cluster
get_cluster_aws_region() {
    # Get region from EKS cluster ARN
    local cluster_arn
    cluster_arn=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null)

    # Extract region from EKS cluster URL
    if [[ "${cluster_arn}" =~ \.([a-z0-9-]+)\.eks\.amazonaws\.com ]]; then
        local region="${BASH_REMATCH[1]}"
        log_debug "Region of the EKS cluster found: ${region}" >&2
        echo "${region}"
        return 0
    else
        log_debug "Region of the EKS cluster not found" >&2
        return 1
    fi
}

# Verify EKS cluster connectivity
aws_eks_verify_cluster() {
    log_info "Verifying EKS cluster connectivity..." >&2

    if ! kubectl cluster-info >/dev/null 2>&1; then
        log_error "Cannot connect to EKS cluster. Please check KUBECONFIG." >&2
        return 1
    fi

    log_success "Successfully connected to EKS cluster" >&2

    local node_count
    node_count=$(kubectl get nodes --no-headers 2>/dev/null | wc -l)
    log_info "Number of nodes: $node_count" >&2

    return 0
}

# Get EKS cluster information
aws_eks_get_cluster_info() {
    log_info "EKS Cluster Information:" >&2
    echo "========================" >&2

    # Get cluster version
    kubectl version --short 2>/dev/null | grep "Server Version" >&2 || echo "Server Version: Unable to determine" >&2

    # Get node information
    echo "Node Information:" >&2
    kubectl get nodes -o custom-columns="NAME:.metadata.name,STATUS:.status.conditions[?(@.type=='Ready')].status,INSTANCE-TYPE:.metadata.labels.node\.kubernetes\.io/instance-type,SPOT:.metadata.labels.kubernetes\.aws\.com/spot" --no-headers 2>/dev/null | while read -r line; do
        echo "  $line" >&2
    done || echo "  Unable to get node information" >&2

    # Get installed addons
    echo "Installed Addons:" >&2

    # Check AWS Load Balancer Controller
    if kubectl get pods -A -l app.kubernetes.io/name=aws-load-balancer-controller 2>/dev/null | grep -q aws-load-balancer-controller; then
        echo "  - AWS Load Balancer Controller: Installed" >&2
    else
        echo "  - AWS Load Balancer Controller: Not found" >&2
    fi

    # Check AWS EBS CSI Driver
    if kubectl get pods -A -l app.kubernetes.io/name=aws-ebs-csi-driver 2>/dev/null | grep -q ebs-csi; then
        echo "  - AWS EBS CSI Driver: Installed" >&2
    else
        echo "  - AWS EBS CSI Driver: Not found" >&2
    fi

    return 0
}

# ============================================================================
# EKS LOAD BALANCER OPERATIONS
# ============================================================================

aws_eks_get_load_balancer_hostname() {
    local namespace="$1"
    local service_name="$2"

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

# ============================================================================
# EKS INGRESS CONFIGURATION
# ============================================================================

configure_eks_ingress_and_dns() {
    local namespace="$1"
    local ingress_name="${2:-backstage}"

    log_info "Setting up EKS ingress hosts configuration..." >&2

    # Wait for ingress to be available
    log_info "Waiting for ingress ${ingress_name} to be available in namespace ${namespace}..." >&2

    local max_attempts=30
    local wait_seconds=10
    local ingress_address=""

    for ((i = 1; i <= max_attempts; i++)); do
        log_debug "Attempt ${i} of ${max_attempts} to get ingress address..." >&2

        # Get the ingress address dynamically
        ingress_address=$(kubectl get ingress "${ingress_name}" -n "${namespace}" \
            -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)

        if [[ -n "${ingress_address}" ]]; then
            log_success "Successfully retrieved ingress address" >&2
            break
        else
            log_debug "Ingress address not available yet, waiting ${wait_seconds} seconds..." >&2
            sleep "${wait_seconds}"
        fi
    done

    if [[ -z "${ingress_address}" ]]; then
        log_error "Failed to get ingress address after ${max_attempts} attempts" >&2
        return 1
    fi

    export EKS_INGRESS_HOSTNAME="${ingress_address}"
    log_success "EKS ingress hosts configuration completed successfully" >&2

    # Update DNS record in Route53 if domain name is configured
    if [[ -n "${EKS_INSTANCE_DOMAIN_NAME}" ]]; then
        local masked_domain
        local masked_target
        masked_domain=$(mask_value "${EKS_INSTANCE_DOMAIN_NAME}")
        masked_target=$(mask_value "${ingress_address}")
        log_info "Updating DNS record for domain ${masked_domain} -> target ${masked_target}" >&2

        if update_route53_dns_record "${EKS_INSTANCE_DOMAIN_NAME}" "${ingress_address}"; then
            log_success "DNS record updated successfully" >&2

            # Verify DNS resolution
            if verify_dns_resolution "${EKS_INSTANCE_DOMAIN_NAME}" "${ingress_address}" 30 15; then
                log_success "DNS resolution verified successfully" >&2
            else
                log_warning "DNS resolution verification failed, but record was updated" >&2
            fi
        else
            log_warning "Failed to update DNS record, but ingress is still functional" >&2
        fi
    else
        log_info "No domain name configured, skipping DNS update" >&2
    fi

    return 0
}

# ============================================================================
# ROUTE53 DNS OPERATIONS
# ============================================================================

update_route53_dns_record() {
    local domain_name="$1"
    local target_value="$2"

    local masked_domain
    local masked_target
    masked_domain=$(mask_value "${domain_name}")
    masked_target=$(mask_value "${target_value}")
    log_info "Updating DNS record for domain ${masked_domain} -> target ${masked_target}" >&2

    # Use global parent domain from secret
    if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
        log_error "AWS_EKS_PARENT_DOMAIN environment variable is not set" >&2
        return 1
    fi

    log_debug "Using configured parent domain" >&2

    # Get the hosted zone ID for the parent domain
    local hosted_zone_id
    hosted_zone_id=$(aws route53 list-hosted-zones \
        --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" \
        --output text 2>/dev/null)

    if [[ -z "${hosted_zone_id}" ]]; then
        log_error "No hosted zone found for configured parent domain" >&2
        return 1
    fi

    # Remove the '/hostedzone/' prefix
    hosted_zone_id="${hosted_zone_id#/hostedzone/}"
    log_debug "Found hosted zone for configured parent domain" >&2

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
    log_info "Applying DNS change..." >&2
    local change_id
    change_id=$(aws route53 change-resource-record-sets \
        --hosted-zone-id "${hosted_zone_id}" \
        --change-batch file:///tmp/dns-change.json \
        --query 'ChangeInfo.Id' \
        --output text 2>/dev/null)

    if [[ $? -eq 0 && -n "${change_id}" ]]; then
        log_success "DNS change submitted successfully" >&2

        # Wait for the change to be propagated
        log_info "Waiting for DNS change to be propagated..." >&2
        aws route53 wait resource-record-sets-changed --id "${change_id}"

        if [[ $? -eq 0 ]]; then
            log_success "DNS change has been propagated" >&2
        else
            log_warning "DNS change may still be propagating" >&2
        fi
    else
        log_error "Failed to apply DNS change" >&2
        rm -f /tmp/dns-change.json
        return 1
    fi

    # Clean up temporary file
    rm -f /tmp/dns-change.json
    return 0
}

verify_dns_resolution() {
    local domain_name="$1"
    local expected_target="$2"
    local max_attempts="${3:-30}"
    local wait_seconds="${4:-10}"

    log_info "Verifying DNS resolution for configured domain" >&2

    for ((i = 1; i <= max_attempts; i++)); do
        log_debug "Checking DNS resolution (attempt ${i}/${max_attempts})..." >&2

        # Use nslookup to check DNS resolution
        local resolved_target
        resolved_target=$(nslookup "${domain_name}" 2>/dev/null | grep -A1 "Name:" | tail -1 | awk '{print $2}')

        if [[ -n "${resolved_target}" && "${resolved_target}" != "NXDOMAIN" ]]; then
            log_debug "DNS record found" >&2

            # If we have an expected target, verify it matches
            if [[ -n "${expected_target}" ]]; then
                # For CNAME records, the resolved target will be an IP address, not the hostname
                # So we just check that it's a valid IP address (contains dots and numbers)
                if [[ "${resolved_target}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                    log_success "DNS record is resolving to a valid IP address" >&2
                    return 0
                else
                    log_debug "DNS record target doesn't look like a valid IP address" >&2
                fi
            else
                log_success "DNS record is resolving" >&2
                return 0
            fi
        else
            log_debug "DNS record not found yet (attempt ${i}/${max_attempts})" >&2
        fi

        if [[ $i -lt $max_attempts ]]; then
            sleep "${wait_seconds}"
        fi
    done

    log_error "DNS resolution verification failed after ${max_attempts} attempts" >&2
    return 1
}

# ============================================================================
# EKS CERTIFICATE MANAGEMENT
# ============================================================================

get_eks_certificate() {
    local domain_name="$1"

    log_info "Retrieving certificate for configured domain" >&2

    # Check if AWS CLI is available
    if ! command -v aws &>/dev/null; then
        log_error "AWS CLI is not installed or not in PATH" >&2
        return 1
    fi

    # Check if AWS credentials are configured
    if ! aws sts get-caller-identity &>/dev/null; then
        log_error "AWS credentials are not configured or invalid" >&2
        return 1
    fi

    # Get the cluster region
    local region
    region=$(get_cluster_aws_region)
    if [[ $? -ne 0 ]]; then
        log_error "Failed to get cluster AWS region" >&2
        return 1
    fi
    log_info "Using region: ${region}" >&2

    # List certificates and find the one for our domain
    log_info "Searching for certificate in AWS Certificate Manager..." >&2
    local certificate_arn
    certificate_arn=$(aws acm list-certificates --region "${region}" \
        --query "CertificateSummaryList[].{DomainName:DomainName,Status:Status,CertificateArn:CertificateArn}" \
        --output json | jq -r ".[] | select(.DomainName == \"${domain_name}\") | .CertificateArn")

    if [[ -z "${certificate_arn}" ]]; then
        log_warning "No existing certificate found for domain" >&2
        log_info "Creating new certificate..." >&2

        # Create a new certificate
        local new_certificate_arn
        new_certificate_arn=$(aws acm request-certificate \
            --region "${region}" \
            --domain-name "${domain_name}" \
            --validation-method DNS \
            --query 'CertificateArn' \
            --output text 2>/dev/null)

        if [[ $? -ne 0 || -z "${new_certificate_arn}" ]]; then
            log_error "Failed to create new certificate for domain: ${domain_name}" >&2
            return 1
        fi

        log_success "New certificate created successfully" >&2
        certificate_arn="${new_certificate_arn}"

        # Wait for certificate validation (simplified version)
        log_info "Waiting for certificate to be validated..." >&2
        local max_attempts=60
        local wait_seconds=30

        for ((i = 1; i <= max_attempts; i++)); do
            log_debug "Checking certificate status (attempt ${i}/${max_attempts})..." >&2

            local cert_status
            cert_status=$(aws acm describe-certificate --region "${region}" \
                --certificate-arn "${certificate_arn}" \
                --query 'Certificate.Status' \
                --output text 2>/dev/null)

            if [[ "${cert_status}" == "ISSUED" ]]; then
                log_success "Certificate has been issued successfully" >&2
                break
            elif [[ "${cert_status}" == "FAILED" ]]; then
                log_error "Certificate validation failed" >&2
                return 1
            elif [[ "${cert_status}" == "PENDING_VALIDATION" ]]; then
                log_debug "Certificate is pending validation (attempt ${i}/${max_attempts})" >&2
                if [[ $i -lt $max_attempts ]]; then
                    sleep "${wait_seconds}"
                fi
            fi
        done
    else
        log_info "Found existing certificate ARN" >&2
    fi

    # Export certificate ARN as environment variable for use in other scripts
    export EKS_DOMAIN_NAME_CERTIFICATE_ARN="${certificate_arn}"
    log_success "Certificate ARN exported as EKS_DOMAIN_NAME_CERTIFICATE_ARN" >&2

    return 0
}

# ============================================================================
# EKS CLEANUP
# ============================================================================

cleanup_eks_dns_record() {
    local domain_name="$1"

    log_info "Cleaning up EKS DNS record" >&2

    # Use global parent domain from secret
    if [[ -z "${AWS_EKS_PARENT_DOMAIN}" ]]; then
        log_error "AWS_EKS_PARENT_DOMAIN environment variable is not set" >&2
        return 1
    fi

    log_debug "Using configured parent domain" >&2

    # Get the hosted zone ID for the parent domain
    local hosted_zone_id
    hosted_zone_id=$(aws route53 list-hosted-zones \
        --query "HostedZones[?Name == '${AWS_EKS_PARENT_DOMAIN}.' || Name == '${AWS_EKS_PARENT_DOMAIN}'].Id" \
        --output text 2>/dev/null)

    if [[ -z "${hosted_zone_id}" ]]; then
        log_error "No hosted zone found for parent domain" >&2
        return 1
    fi

    # Remove the '/hostedzone/' prefix
    hosted_zone_id="${hosted_zone_id#/hostedzone/}"
    log_debug "Found hosted zone for configured parent domain" >&2

    # Check if the DNS record exists before attempting to delete it
    log_info "Checking if DNS record exists" >&2
    local existing_record
    existing_record=$(aws route53 list-resource-record-sets \
        --hosted-zone-id "${hosted_zone_id}" \
        --query "ResourceRecordSets[?Name == '${domain_name}.'].{Name:Name,Type:Type,TTL:TTL,ResourceRecords:ResourceRecords}" \
        --output json 2>/dev/null)

    if [[ -z "${existing_record}" ]] || [[ "${existing_record}" == "[]" ]] || [[ "${existing_record}" == "null" ]]; then
        log_info "DNS record does not exist, nothing to clean up" >&2
        return 0
    fi

    log_info "Found existing DNS record, deleting..." >&2

    # Extract the record details for deletion
    local record_type
    local record_ttl
    local record_values

    record_type=$(echo "${existing_record}" | jq -r '.[0].Type' 2>/dev/null)
    record_ttl=$(echo "${existing_record}" | jq -r '.[0].TTL' 2>/dev/null)
    record_values=$(echo "${existing_record}" | jq -r '.[0].ResourceRecords[0].Value' 2>/dev/null)

    # Create the change batch JSON for deletion
    cat > /tmp/dns-delete.json << EOF
{
  "Changes": [
    {
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "${domain_name}.",
        "Type": "${record_type}",
        "TTL": ${record_ttl},
        "ResourceRecords": [
          {
            "Value": "${record_values}"
          }
        ]
      }
    }
  ]
}
EOF

    # Apply the DNS deletion
    log_info "Deleting DNS record..." >&2
    local change_id
    change_id=$(aws route53 change-resource-record-sets \
        --hosted-zone-id "${hosted_zone_id}" \
        --change-batch file:///tmp/dns-delete.json \
        --query 'ChangeInfo.Id' \
        --output text 2>/dev/null)

    if [[ $? -eq 0 && -n "${change_id}" ]]; then
        log_success "DNS record deletion submitted successfully" >&2
    else
        log_error "Failed to delete DNS record" >&2
    fi

    # Clean up temporary file
    rm -f /tmp/dns-delete.json
    return 0
}

# Export functions
export -f mask_value aws_configure get_cluster_aws_region
export -f aws_eks_verify_cluster aws_eks_get_cluster_info aws_eks_get_load_balancer_hostname
export -f configure_eks_ingress_and_dns update_route53_dns_record verify_dns_resolution
export -f get_eks_certificate cleanup_eks_dns_record