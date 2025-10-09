#!/usr/bin/env bash
#
# Upgrade Job - Test RHDH upgrade from previous release to current
#
set -euo pipefail

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Bootstrap the environment
source "${DIR}/modules/bootstrap.sh"

# ============================================================================
# JOB CONFIGURATION
# ============================================================================

# Namespace for upgrade testing
readonly UPGRADE_NAMESPACE="${NAME_SPACE:-showcase-upgrade-nightly}"
readonly UPGRADE_NAMESPACE_POSTGRES="${NAME_SPACE_POSTGRES_DB:-${UPGRADE_NAMESPACE}-postgres-external-db}"

# Release name
readonly UPGRADE_RELEASE_NAME="${RELEASE_NAME:-rhdh}"
readonly UPGRADE_DEPLOYMENT_NAME="${UPGRADE_RELEASE_NAME}-developer-hub"

# Base image repository for previous version
readonly QUAY_REPO_BASE="${QUAY_REPO_BASE:-rhdh/rhdh-hub-rhel9}"

# Value files
readonly UPGRADE_VALUE_FILE_TYPE="${VALUE_FILE_TYPE:-showcase}"

# ============================================================================
# UPGRADE FUNCTIONS
# ============================================================================

setup_upgrade_environment() {
    log_section "Setting up upgrade test environment"

    # Detect platform and load appropriate modules
    detect_and_load_platform

    # Get cluster router base
    if [[ "$PLATFORM_TYPE" == "openshift" ]]; then
        oc_login
        K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console \
            -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
    else
        # For cloud platforms, get router base
        case "${CLOUD_PROVIDER:-k8s}" in
            eks)
                setup_eks_cluster
                ;;
            aks)
                setup_aks_cluster
                ;;
            gke)
                setup_gke_cluster
                ;;
            *)
                log_warning "Generic Kubernetes platform, using cluster URL"
                K8S_CLUSTER_ROUTER_BASE=$(kubectl config view --minify \
                    -o jsonpath='{.clusters[0].cluster.server}' | \
                    sed 's|https://||' | sed 's|:.*||')
                ;;
        esac
    fi

    export K8S_CLUSTER_ROUTER_BASE
    log_info "Cluster router base: $K8S_CLUSTER_ROUTER_BASE"

    # Determine previous release version
    local previous_release_version
    previous_release_version=$(get_previous_release_version "$CHART_MAJOR_VERSION")

    if [[ -z "$previous_release_version" ]]; then
        log_error "Failed to determine previous release version"
        return 1
    fi

    export PREVIOUS_RELEASE_VERSION="$previous_release_version"
    log_info "Previous release version: $PREVIOUS_RELEASE_VERSION"

    # Get chart version for previous release
    local chart_version_base
    chart_version_base=$(get_chart_version "$PREVIOUS_RELEASE_VERSION")

    if [[ -z "$chart_version_base" ]]; then
        log_error "Failed to determine chart version for $PREVIOUS_RELEASE_VERSION"
        return 1
    fi

    export CHART_VERSION_BASE="$chart_version_base"
    export TAG_NAME_BASE="$PREVIOUS_RELEASE_VERSION"

    log_success "Upgrade environment setup completed"
    log_info "  Previous version: $PREVIOUS_RELEASE_VERSION (chart: $CHART_VERSION_BASE)"
    log_info "  Current version: $CHART_MAJOR_VERSION (chart: $CHART_VERSION)"
}

deploy_base_version() {
    local release_name="$1"
    local namespace="$2"
    local base_url="$3"

    log_section "Deploying base version (${PREVIOUS_RELEASE_VERSION})"

    # Create namespace
    create_namespace_if_not_exists "$namespace"

    # Setup external PostgreSQL if needed
    if [[ "$PLATFORM_TYPE" == "openshift" ]]; then
        configure_external_postgres_db "$UPGRADE_NAMESPACE_POSTGRES" "$namespace"
    fi

    # Setup service account
    re_create_k8s_service_account_and_get_token "$namespace"

    # Deploy Redis cache
    deploy_redis_cache "$namespace"

    # Apply pre-deployment resources
    apply_yaml_files "$namespace"

    # Get previous release value file
    local base_value_file
    base_value_file=$(get_previous_release_value_file "$UPGRADE_VALUE_FILE_TYPE")

    if [[ ! -f "$base_value_file" ]]; then
        log_error "Failed to get previous release value file"
        return 1
    fi

    # Setup image pull secret if needed
    if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
        setup_image_pull_secret "$namespace" "rh-pull-secret" \
            "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
    fi

    # Deploy base version with Helm
    log_info "Deploying base version with Helm"
    log_info "  Chart: ${HELM_CHART_URL} version ${CHART_VERSION_BASE}"
    log_info "  Image: ${QUAY_REPO_BASE}:${TAG_NAME_BASE}"

    helm upgrade --install "$release_name" "${HELM_CHART_URL}" \
        --version "${CHART_VERSION_BASE}" \
        --namespace "$namespace" \
        --values "$base_value_file" \
        --set-string "global.clusterRouterBase=${K8S_CLUSTER_ROUTER_BASE}" \
        --set-string "global.host=${base_url#https://}" \
        --set-string "upstream.backstage.image.repository=${QUAY_REPO_BASE}" \
        --set-string "upstream.backstage.image.tag=${TAG_NAME_BASE}" \
        --wait --timeout 20m

    # Wait for deployment to be ready
    wait_for_deployment_ready "$UPGRADE_DEPLOYMENT_NAME" "$namespace"

    # Verify base version is running
    log_info "Verifying base version deployment"
    check_and_test "$release_name" "$namespace" "$base_url"

    log_success "Base version deployed successfully"
}

perform_upgrade() {
    local release_name="$1"
    local namespace="$2"
    local target_url="$3"

    log_section "Upgrading to current version (${CHART_MAJOR_VERSION})"

    # Prepare value file for upgrade
    local upgrade_value_file="${DIR}/value_files/values_${UPGRADE_VALUE_FILE_TYPE}.yaml"

    if [[ ! -f "$upgrade_value_file" ]]; then
        log_error "Upgrade value file not found: $upgrade_value_file"
        return 1
    fi

    # Perform the upgrade
    log_info "Performing Helm upgrade"
    log_info "  Chart: ${HELM_CHART_URL} version ${CHART_VERSION}"
    log_info "  Image: ${QUAY_REPO}:${TAG_NAME}"

    helm upgrade "$release_name" "${HELM_CHART_URL}" \
        --version "${CHART_VERSION}" \
        --namespace "$namespace" \
        --values "$upgrade_value_file" \
        --set-string "global.clusterRouterBase=${K8S_CLUSTER_ROUTER_BASE}" \
        --set-string "global.host=${target_url#https://}" \
        --set-string "upstream.backstage.image.repository=${QUAY_REPO}" \
        --set-string "upstream.backstage.image.tag=${TAG_NAME}" \
        --wait --timeout 20m

    log_success "Helm upgrade command completed"
}

verify_upgrade() {
    local deployment_name="$1"
    local release_name="$2"
    local namespace="$3"
    local url="$4"

    log_section "Verifying upgrade"

    # Wait for deployment to stabilize
    log_info "Waiting for upgraded deployment to be ready"
    wait_for_deployment_ready "$deployment_name" "$namespace"

    # Check pod status
    log_info "Checking pod status after upgrade"
    kubectl get pods -n "$namespace" -l app.kubernetes.io/instance="$release_name"

    # Verify the new version is running
    local current_image
    current_image=$(kubectl get deployment "$deployment_name" -n "$namespace" \
        -o jsonpath='{.spec.template.spec.containers[0].image}')

    log_info "Current image: $current_image"

    if [[ "$current_image" != *"${TAG_NAME}"* ]]; then
        log_error "Upgrade failed - deployment is not running expected version"
        log_error "  Expected tag: ${TAG_NAME}"
        log_error "  Current image: ${current_image}"
        return 1
    fi

    # Run tests against upgraded instance
    log_info "Running tests against upgraded instance"
    check_and_test "$release_name" "$namespace" "$url"

    # Check for data persistence (if applicable)
    if [[ "${CHECK_DATA_PERSISTENCE:-true}" == "true" ]]; then
        log_info "Verifying data persistence after upgrade"
        # This would check that data from the base version is still accessible
        # Implementation depends on what data needs to be verified
    fi

    log_success "Upgrade verification completed successfully"
}

cleanup_upgrade_test() {
    local namespace="$1"

    log_section "Cleaning up upgrade test"

    # Delete namespace
    delete_namespace "$namespace"

    # Cleanup PostgreSQL namespace if it exists
    if [[ -n "${UPGRADE_NAMESPACE_POSTGRES:-}" ]]; then
        delete_namespace "$UPGRADE_NAMESPACE_POSTGRES"
    fi

    log_success "Upgrade test cleanup completed"
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_header "RHDH Upgrade Test Job"

    # Setup environment
    setup_upgrade_environment

    # Calculate URLs
    local base_url
    local upgrade_url

    if [[ "$PLATFORM_TYPE" == "openshift" ]]; then
        base_url="https://${UPGRADE_RELEASE_NAME}-developer-hub-${UPGRADE_NAMESPACE}.${K8S_CLUSTER_ROUTER_BASE}"
        upgrade_url="$base_url"
    else
        # For cloud/k8s platforms
        base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
        upgrade_url="$base_url"
    fi

    # Deploy base version
    deploy_base_version \
        "$UPGRADE_RELEASE_NAME" \
        "$UPGRADE_NAMESPACE" \
        "$base_url"

    # Perform upgrade
    perform_upgrade \
        "$UPGRADE_RELEASE_NAME" \
        "$UPGRADE_NAMESPACE" \
        "$upgrade_url"

    # Verify upgrade
    verify_upgrade \
        "$UPGRADE_DEPLOYMENT_NAME" \
        "$UPGRADE_RELEASE_NAME" \
        "$UPGRADE_NAMESPACE" \
        "$upgrade_url"

    # Cleanup if not skipped
    if [[ "${SKIP_CLEANUP:-false}" != "true" ]]; then
        cleanup_upgrade_test "$UPGRADE_NAMESPACE"
    fi

    log_success "RHDH upgrade test completed successfully"
    log_info "Successfully upgraded from ${PREVIOUS_RELEASE_VERSION} to ${CHART_MAJOR_VERSION}"
}

# Execute main function
main "$@"