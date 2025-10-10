#!/usr/bin/env bash
#
# Google GKE Cloud Helper Module
# Provides GCP/GKE specific functions for deployments
#

# Guard to prevent multiple sourcing
if [[ -n "${_GKE_LOADED:-}" ]]; then
    return 0
fi
readonly _GKE_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../retry.sh"

# ============================================================================
# GCP AUTHENTICATION
# ============================================================================

gcloud_auth() {
    local service_account_name="$1"
    local service_account_key_location="$2"

    if [[ -z "$service_account_name" || -z "$service_account_key_location" ]]; then
        log_error "Usage: gcloud_auth <service_account_name> <key_file_path>" >&2
        return 1
    fi

    log_info "Authenticating with GCP service account..." >&2

    # Check if key file exists
    if [[ ! -f "$service_account_key_location" ]]; then
        log_error "Service account key file not found: $service_account_key_location" >&2
        return 1
    fi

    # Activate service account
    if gcloud auth activate-service-account "${service_account_name}" \
        --key-file "${service_account_key_location}" >/dev/null 2>&1; then
        log_success "GCP authentication successful" >&2
        return 0
    else
        log_error "GCP authentication failed" >&2
        return 1
    fi
}

# ============================================================================
# GKE CLUSTER OPERATIONS
# ============================================================================

gcloud_gke_get_credentials() {
    local cluster_name="$1"
    local cluster_region="$2"
    local project="$3"

    if [[ -z "$cluster_name" || -z "$cluster_region" || -z "$project" ]]; then
        log_error "Usage: gcloud_gke_get_credentials <cluster_name> <region> <project>" >&2
        return 1
    fi

    log_info "Getting GKE cluster credentials: $cluster_name" >&2

    if gcloud container clusters get-credentials \
        "${cluster_name}" \
        --region "${cluster_region}" \
        --project "${project}" >/dev/null 2>&1; then
        log_success "GKE credentials obtained successfully" >&2

        # Verify connectivity
        if kubectl cluster-info >/dev/null 2>&1; then
            log_success "Successfully connected to GKE cluster" >&2
            return 0
        else
            log_error "Failed to connect to GKE cluster after obtaining credentials" >&2
            return 1
        fi
    else
        log_error "Failed to get GKE credentials" >&2
        return 1
    fi
}

# ============================================================================
# GKE SSL CERTIFICATE MANAGEMENT
# ============================================================================

gcloud_ssl_cert_create() {
    local cert_name="$1"
    local domain="$2"
    local project="$3"

    if [[ -z "$cert_name" || -z "$domain" || -z "$project" ]]; then
        log_error "Usage: gcloud_ssl_cert_create <cert_name> <domain> <project>" >&2
        return 1
    fi

    log_info "Creating SSL certificate: $cert_name for domain: $domain" >&2

    local output
    output=$(gcloud compute ssl-certificates create "${cert_name}" \
        --domains="${domain}" \
        --project="${project}" \
        --global 2>&1) || true

    # Check if the output contains ERROR
    if echo "$output" | grep -q "ERROR"; then
        # Check if the error is due to certificate already existing
        if echo "$output" | grep -q "already exists"; then
            log_info "Certificate '${cert_name}' already exists, continuing..." >&2
            return 0
        else
            log_error "Error creating certificate '${cert_name}':" >&2
            echo "$output" >&2
            return 1
        fi
    else
        log_success "Certificate '${cert_name}' created successfully" >&2
        log_warning "The deployment might fail if the certificate is not obtained from the certificate authority in time" >&2
        return 0
    fi
}

# ============================================================================
# GKE CLUSTER INFO
# ============================================================================

gke_get_cluster_info() {
    log_info "GKE Cluster Information:" >&2
    echo "========================" >&2

    # Get cluster version
    kubectl version --short 2>/dev/null | grep "Server Version" >&2 || echo "Server Version: Unable to determine" >&2

    # Get node information
    echo "Node Information:" >&2
    kubectl get nodes -o wide --no-headers 2>/dev/null | while read -r line; do
        echo "  $line" >&2
    done || echo "  Unable to get node information" >&2

    # Get installed addons
    echo "Installed Addons:" >&2

    # Check for common GKE addons
    local gke_addons=("gke-metrics-agent" "kube-dns" "kube-proxy" "gke-metadata-server")
    for addon in "${gke_addons[@]}"; do
        if kubectl get pods -n kube-system 2>/dev/null | grep -q "$addon"; then
            echo "  - $addon: Installed" >&2
        fi
    done

    # Check for ingress controller
    if kubectl get pods -A 2>/dev/null | grep -q "ingress"; then
        echo "  - Ingress Controller: Installed" >&2
    fi

    return 0
}

# ============================================================================
# GKE INGRESS CONFIGURATION
# ============================================================================

configure_gke_ingress() {
    local namespace="$1"
    local ingress_name="${2:-backstage}"

    log_info "Configuring GKE ingress in namespace: $namespace" >&2

    # Wait for ingress to be available
    log_info "Waiting for ingress $ingress_name to be available..." >&2

    local max_attempts=30
    local wait_seconds=10
    local ingress_address=""

    for ((i = 1; i <= max_attempts; i++)); do
        log_debug "Attempt $i of $max_attempts to get ingress address..." >&2

        # Get the ingress address (GKE typically uses IP)
        ingress_address=$(kubectl get ingress "$ingress_name" -n "$namespace" \
            -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)

        # If not IP, try hostname
        if [[ -z "$ingress_address" ]]; then
            ingress_address=$(kubectl get ingress "$ingress_name" -n "$namespace" \
                -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
        fi

        if [[ -n "$ingress_address" ]]; then
            log_success "Successfully retrieved ingress address: $ingress_address" >&2
            break
        else
            log_debug "Ingress address not available yet, waiting $wait_seconds seconds..." >&2
            sleep "$wait_seconds"
        fi
    done

    if [[ -z "$ingress_address" ]]; then
        log_error "Failed to get ingress address after $max_attempts attempts" >&2
        return 1
    fi

    export GKE_INGRESS_ADDRESS="$ingress_address"
    log_success "GKE ingress configuration completed successfully" >&2

    # Update Cloud DNS if domain is configured
    if [[ -n "${GKE_DOMAIN_NAME}" && -n "${GCP_PROJECT}" ]]; then
        log_info "Updating Cloud DNS record for domain: ${GKE_DOMAIN_NAME}" >&2
        if update_gcp_dns_record "${GKE_DOMAIN_NAME}" "${ingress_address}" "${GCP_PROJECT}"; then
            log_success "DNS record updated successfully" >&2
        else
            log_warning "Failed to update DNS record, but ingress is still functional" >&2
        fi
    else
        log_info "No domain name configured, skipping DNS update" >&2
    fi

    return 0
}

# ============================================================================
# GCP CLOUD DNS OPERATIONS
# ============================================================================

update_gcp_dns_record() {
    local domain_name="$1"
    local target_ip="$2"
    local project="$3"

    if [[ -z "$domain_name" || -z "$target_ip" || -z "$project" ]]; then
        log_error "Usage: update_gcp_dns_record <domain> <target_ip> <project>" >&2
        return 1
    fi

    log_info "Updating Cloud DNS record for $domain_name -> $target_ip" >&2

    # Get the managed zone name (usually derived from domain)
    local zone_name
    zone_name=$(echo "$domain_name" | sed 's/\./-/g')

    # Check if the zone exists
    if ! gcloud dns managed-zones describe "$zone_name" --project="$project" >/dev/null 2>&1; then
        log_warning "DNS zone $zone_name not found, skipping DNS update" >&2
        return 1
    fi

    # Start a transaction
    gcloud dns record-sets transaction start --zone="$zone_name" --project="$project"

    # Remove old record if exists
    local old_ip
    old_ip=$(gcloud dns record-sets list --zone="$zone_name" --project="$project" \
        --filter="name=$domain_name." --format="value(rrdatas[0])" 2>/dev/null)

    if [[ -n "$old_ip" ]]; then
        gcloud dns record-sets transaction remove "$old_ip" \
            --name="$domain_name." \
            --ttl=300 \
            --type=A \
            --zone="$zone_name" \
            --project="$project"
    fi

    # Add new record
    gcloud dns record-sets transaction add "$target_ip" \
        --name="$domain_name." \
        --ttl=300 \
        --type=A \
        --zone="$zone_name" \
        --project="$project"

    # Execute transaction
    if gcloud dns record-sets transaction execute --zone="$zone_name" --project="$project"; then
        log_success "DNS record updated successfully" >&2
        return 0
    else
        log_error "Failed to update DNS record" >&2
        # Abort transaction if it fails
        gcloud dns record-sets transaction abort --zone="$zone_name" --project="$project" 2>/dev/null
        return 1
    fi
}

# ============================================================================
# GKE SERVICE ACCOUNT OPERATIONS
# ============================================================================

gke_create_workload_identity() {
    local namespace="$1"
    local service_account="$2"
    local gcp_service_account="$3"
    local project="$4"

    log_info "Setting up Workload Identity for GKE" >&2

    # Create GCP service account if it doesn't exist
    if ! gcloud iam service-accounts describe "${gcp_service_account}@${project}.iam.gserviceaccount.com" \
        --project="${project}" >/dev/null 2>&1; then
        log_info "Creating GCP service account: ${gcp_service_account}" >&2
        gcloud iam service-accounts create "${gcp_service_account}" \
            --display-name="${gcp_service_account}" \
            --project="${project}"
    fi

    # Create Kubernetes service account if it doesn't exist
    if ! kubectl get serviceaccount "${service_account}" -n "${namespace}" >/dev/null 2>&1; then
        log_info "Creating Kubernetes service account: ${service_account}" >&2
        kubectl create serviceaccount "${service_account}" -n "${namespace}"
    fi

    # Bind the accounts
    log_info "Binding Kubernetes and GCP service accounts" >&2
    gcloud iam service-accounts add-iam-policy-binding \
        "${gcp_service_account}@${project}.iam.gserviceaccount.com" \
        --role roles/iam.workloadIdentityUser \
        --member "serviceAccount:${project}.svc.id.goog[${namespace}/${service_account}]" \
        --project="${project}"

    # Annotate the Kubernetes service account
    kubectl annotate serviceaccount "${service_account}" \
        -n "${namespace}" \
        iam.gke.io/gcp-service-account="${gcp_service_account}@${project}.iam.gserviceaccount.com" \
        --overwrite

    log_success "Workload Identity configured successfully" >&2
    return 0
}

# ============================================================================
# GKE CLEANUP
# ============================================================================

cleanup_gke() {
    log_info "Starting GKE cleanup..." >&2

    # Import operator functions if needed
    local operator_module="$(dirname "${BASH_SOURCE[0]}")/../../install-methods/operator.sh"
    if [[ -f "$operator_module" ]]; then
        source "$operator_module"

        # Call operator cleanup functions if they exist
        if command -v delete_tekton_pipelines >/dev/null 2>&1; then
            delete_tekton_pipelines
        fi

        if command -v uninstall_olm >/dev/null 2>&1; then
            uninstall_olm
        fi

        if command -v delete_rhdh_operator >/dev/null 2>&1; then
            delete_rhdh_operator
        fi
    else
        log_warning "Operator module not found, skipping operator cleanup" >&2
    fi

    log_info "GKE cleanup completed" >&2
    return 0
}

cleanup_gke_deployment() {
    local namespace=$1
    log_info "Cleaning up GKE deployment in namespace: ${namespace}"
    delete_namespace "$namespace"
}

cleanup_gke_dns_record() {
    local domain_name=$1
    local zone="${GCP_DNS_ZONE:-rhdh-zone}"

    log_info "Cleaning up GKE DNS record: ${domain_name}"

    # Check if the DNS record exists
    local record_exists
    record_exists=$(gcloud dns record-sets list --zone="${zone}" --name="${domain_name}." --format="value(name)" 2>/dev/null || echo "")

    if [[ -z "${record_exists}" ]]; then
        log_success "DNS record does not exist, nothing to clean up"
        return 0
    fi

    log_info "Found existing DNS record, deleting..."

    # Get the current record data
    local record_type
    local record_ttl
    local record_data

    record_type=$(gcloud dns record-sets list --zone="${zone}" --name="${domain_name}." --format="value(type)" | head -n1)
    record_ttl=$(gcloud dns record-sets list --zone="${zone}" --name="${domain_name}." --format="value(ttl)" | head -n1)
    record_data=$(gcloud dns record-sets list --zone="${zone}" --name="${domain_name}." --format="value(rrdatas)" | head -n1)

    if [[ -n "${record_type}" && -n "${record_data}" ]]; then
        # Start a transaction
        gcloud dns record-sets transaction start --zone="${zone}"

        # Remove the record
        gcloud dns record-sets transaction remove "${record_data}" \
            --name="${domain_name}." \
            --type="${record_type}" \
            --ttl="${record_ttl:-300}" \
            --zone="${zone}"

        # Execute the transaction
        if gcloud dns record-sets transaction execute --zone="${zone}"; then
            log_success "DNS record deleted successfully"
        else
            log_error "Failed to delete DNS record"
            # Abort transaction if it fails
            gcloud dns record-sets transaction abort --zone="${zone}" 2>/dev/null || true
            return 1
        fi
    else
        log_warning "Could not retrieve record details for deletion"
        return 1
    fi

    return 0
}

get_gke_certificate() {
    local cert_name="${GKE_CERT_NAME:-rhdh-cert}"

    log_info "Getting GKE certificate: ${cert_name}"

    # Check if certificate exists
    if gcloud compute ssl-certificates describe "${cert_name}" >/dev/null 2>&1; then
        log_info "Found certificate: ${cert_name}"
        echo "${cert_name}"
        return 0
    else
        log_warning "Certificate not found: ${cert_name}"
        return 1
    fi
}

# Export functions
export -f gcloud_auth gcloud_gke_get_credentials gcloud_ssl_cert_create
export -f gke_get_cluster_info configure_gke_ingress update_gcp_dns_record
export -f gke_create_workload_identity cleanup_gke cleanup_gke_deployment
export -f cleanup_gke_dns_record get_gke_certificate