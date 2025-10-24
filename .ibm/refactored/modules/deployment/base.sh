#!/usr/bin/env bash
#
# Base Deployment Module - Standard RHDH deployment functions
#

# Guard to prevent multiple sourcing
if [[ -n "${_BASE_DEPLOYMENT_LOADED:-}" ]]; then
    return 0
fi
readonly _BASE_DEPLOYMENT_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../k8s-operations.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../orchestrator.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../reporting.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../constants.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../retry.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../platform/detection.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../helm.sh"

monitor_deployment_status() {
    local namespace="$1"
    local release_name="$2"
    local interval="${3:-${DEPLOYMENT_CHECK_INTERVAL}}"

    log_info "Monitoring deployment status for ${release_name} in ${namespace}"

    # Check Helm release status
    local helm_status=$(helm status "${release_name}" -n "${namespace}" 2>/dev/null | grep STATUS | awk '{print $2}' || echo "not-found")
    log_info "Helm release status: ${helm_status}"

    # Check deployment status
    # Using constant for deployment name
    local deployment="${DEPLOYMENT_FULLNAME_OVERRIDE}"
    if kubectl get deployment "${deployment}" -n "${namespace}" &>/dev/null; then
        local ready=$(kubectl get deployment "${deployment}" -n "${namespace}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        local desired=$(kubectl get deployment "${deployment}" -n "${namespace}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
        log_info "Deployment replicas: ${ready}/${desired} ready"

        # Check for any pod issues
        # With fullnameOverride, pods still use release name in label
        local problem_pods=$(kubectl get pods -n "${namespace}" -l app.kubernetes.io/instance="${release_name}" \
            --field-selector='status.phase!=Running,status.phase!=Succeeded' --no-headers 2>/dev/null | wc -l)

        if [[ ${problem_pods} -gt 0 ]]; then
            log_warning "Found ${problem_pods} pods with issues:"
            kubectl get pods -n "${namespace}" -l app.kubernetes.io/instance="${release_name}" \
                --field-selector='status.phase!=Running,status.phase!=Succeeded' 2>/dev/null || true
        fi
    else
        log_warning "Deployment ${deployment} not found"
    fi

    # Check service endpoints
    local service="redhat-developer-hub"
    local endpoints=$(kubectl get endpoints "${service}" -n "${namespace}" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | wc -w)
    log_info "Service ${service} has ${endpoints} endpoints"

    # Check route/ingress
    if [[ "${IS_OPENSHIFT}" == "true" ]]; then
        local route=$(oc get route "redhat-developer-hub" -n "${namespace}" -o jsonpath='{.status.ingress[0].conditions[?(@.type=="Admitted")].status}' 2>/dev/null || echo "Unknown")
        log_info "Route status: ${route}"
    fi

    return 0
}

base_deployment() {
    local namespace="${NAME_SPACE}"
    local release_name="${RELEASE_NAME}"

    log_info "Starting base deployment: ${release_name} in ${namespace}"

    # Configure namespace
    configure_namespace "${namespace}"

    # Ensure namespace is ready before proceeding
    ensure_namespace_ready "${namespace}" 30

    # Deploy Redis cache if needed
    if [[ "${DEPLOY_REDIS:-true}" == "true" ]]; then
        deploy_redis_cache "${namespace}"
    fi

    # Apply configuration files (with annotations to avoid Helm conflicts)
    # With fullnameOverride, the service/route will be 'redhat-developer-hub'
    local rhdh_base_url="https://redhat-developer-hub-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
    apply_yaml_files "${DIR}" "${namespace}" "${rhdh_base_url}"

    log_info "Deploying RHDH from: ${QUAY_REPO} with tag: ${TAG_NAME}"

    # Clean up old Jobs that can't be patched
    kubectl delete job "${release_name}-create-sonataflow-database" -n "${namespace}" 2>/dev/null || true

    # Select appropriate value file (with or without orchestrator plugins)
    local value_file=$(select_deployment_value_file "${HELM_CHART_VALUE_FILE_NAME}" "values_showcase_nightly.yaml")

    # Calculate hostname and export BASE_URL variables for CORS/secrets
    local expected_hostname=$(calculate_and_export_base_url "${namespace}")

    # Preflight validation to catch YAML/JSON conversion errors early
    if ! helm_preflight_validate "${release_name}" "${namespace}" "${value_file}" "${expected_hostname}"; then
        log_error "Preflight validation failed for Helm manifests. Aborting deploy."
        return 1
    fi

    # Perform Helm installation with calculated values
    if helm_install_rhdh "${release_name}" "${namespace}" "${value_file}" "${expected_hostname}"; then
        log_success "Base deployment completed successfully"

        # Save deployment status
        save_deployment_status "${namespace}" "success" "Base RHDH deployed successfully"

        # Monitor deployment status
        monitor_deployment_status "${namespace}" "${release_name}"
    else
        log_error "Base deployment failed"

        # Save deployment status
        save_deployment_status "${namespace}" "failed" "Helm installation failed"

        # Show deployment status for debugging
        monitor_deployment_status "${namespace}" "${release_name}"

        # Collect logs for debugging
        collect_deployment_logs "${namespace}"

        # Attempt recovery if possible
        if [[ "${AUTO_RECOVERY:-true}" == "true" ]]; then
            log_info "Attempting automatic recovery..."
            if attempt_deployment_recovery "${namespace}" "redhat-developer-hub"; then
                log_info "Recovery attempted, waiting for deployment to stabilize"
                sleep 30

                # Check if deployment is now healthy
                if wait_for_deployment "${namespace}" "redhat-developer-hub" 120; then
                    log_success "Deployment recovered successfully"
                    save_deployment_status "${namespace}" "success" "Recovered after initial failure"
                    return 0
                fi
            fi
        fi

        return 1
    fi

    # Deploy orchestrator workflows (only when explicitly enabled)
    if [[ "${DEPLOY_ORCHESTRATOR:-false}" == "true" ]]; then
        deploy_orchestrator_workflows "${namespace}"
    fi
}

deploy_redis_cache() {
    local namespace="$1"

    log_info "Deploying Redis cache to ${namespace}"

    # First create redis-secret using envsubst
    if [[ -f "${DIR}/resources/redis-cache/redis-secret.yaml" ]]; then
        log_info "Creating redis-secret from environment variables"

        # Ensure variables are exported for envsubst
        export REDIS_USERNAME_ENCODED="${REDIS_USERNAME_ENCODED:-$(echo -n 'temp' | base64 | tr -d '\n')}"
        export REDIS_PASSWORD_ENCODED="${REDIS_PASSWORD_ENCODED:-$(echo -n 'test123' | base64 | tr -d '\n')}"

        envsubst < "${DIR}/resources/redis-cache/redis-secret.yaml" | kubectl apply -n "${namespace}" -f -
        log_success "Redis secret created"
    else
        log_warning "redis-secret.yaml not found, creating default secret"
        kubectl create secret generic redis-secret \
            --from-literal=REDIS_USERNAME=$(echo -n 'temp' | base64 | tr -d '\n') \
            --from-literal=REDIS_PASSWORD=$(echo -n 'test123' | base64 | tr -d '\n') \
            --namespace="${namespace}" \
            --dry-run=client -o yaml | kubectl apply -f -
    fi

    # Check if Redis already exists and is healthy
    if resource_exists "deployment" "redis" "${namespace}"; then
        local replicas
        replicas=$(kubectl get deployment redis -n "${namespace}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")

        if [[ "${replicas}" -gt 0 ]]; then
            log_info "Redis already deployed and running in ${namespace}"
            return 0
        else
            log_info "Redis exists but not ready, redeploying..."
            kubectl delete deployment redis -n "${namespace}" 2>/dev/null || true
            kubectl delete service redis -n "${namespace}" 2>/dev/null || true
            sleep 2
        fi
    fi

    # Check if we should use the existing redis-deployment.yaml or create inline
    if [[ -f "${DIR}/resources/redis-cache/redis-deployment.yaml" ]]; then
        log_info "Applying Redis deployment from file"
        kubectl apply -f "${DIR}/resources/redis-cache/redis-deployment.yaml" -n "${namespace}"
        log_success "Redis deployment and service created"
        wait_for_redis_ready "${namespace}"
        return 0
    fi

    # Create Redis deployment inline (fallback)
    local redis_yaml=$(cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "200m"
        readinessProbe:
          tcpSocket:
            port: 6379
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          tcpSocket:
            port: 6379
          initialDelaySeconds: 15
          periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: ${namespace}
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
EOF
)

    # Apply with retry using new retry library
    if apply_resource_with_retry "${redis_yaml}" "${namespace}" "${RETRY_APPLY_RESOURCE}" "${RETRY_DELAY_DEFAULT}"; then
        log_success "Redis deployment created"
        wait_for_redis_ready "${namespace}"
    else
        log_error "Failed to deploy Redis after retries"
        return 1
    fi
}

wait_for_redis_ready() {
    local namespace="$1"
    local max_attempts="${RETRY_REDIS_CHECK}"
    local attempt=0

    log_info "Waiting for Redis to be ready in namespace ${namespace}"

    # First wait for deployment to be available
    if ! wait_for_deployment "${namespace}" "redis" "${TIMEOUT_REDIS_READY}"; then
        log_error "Redis deployment failed to become available"
        return 1
    fi

    # Then verify Redis service is responding
    log_info "Verifying Redis service connectivity"
    while [[ $attempt -lt $max_attempts ]]; do
        # Check if pod is running and ready
        local ready_pods
        ready_pods=$(kubectl get pods -n "${namespace}" -l app=redis \
            --field-selector=status.phase=Running \
            -o jsonpath='{.items[*].status.containerStatuses[?(@.ready==true)].ready}' 2>/dev/null)

        if [[ "${ready_pods}" == "true" ]]; then
            # Verify service endpoints exist
            local endpoints
            endpoints=$(kubectl get endpoints redis -n "${namespace}" \
                -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null)

            if [[ -n "${endpoints}" ]]; then
                log_success "Redis is ready and service is available"
                return 0
            fi
        fi

        attempt=$((attempt + 1))
        if [[ $attempt -lt $max_attempts ]]; then
            log_debug "Redis not ready yet (attempt ${attempt}/${max_attempts}), waiting..."
            sleep "${RETRY_DELAY_REDIS}"
        fi
    done

    log_error "Redis failed to become ready after ${max_attempts} attempts"
    kubectl get pods -n "${namespace}" -l app=redis
    kubectl describe pods -n "${namespace}" -l app=redis | tail -20
    return 1
}

deploy_test_backstage_customization_provider() {
    local namespace="$1"

    log_info "Deploying test-backstage-customization-provider in namespace ${namespace}"

    # Check if BuildConfig already exists
    if ! oc get buildconfig test-backstage-customization-provider -n "${namespace}" > /dev/null 2>&1; then
        log_info "Creating new app for test-backstage-customization-provider"
        # Create app from GitHub source using OpenShift's nodejs image stream
        oc new-app https://github.com/janus-qe/test-backstage-customization-provider \
            --image-stream="openshift/nodejs:18-ubi8" \
            --namespace="${namespace}"
    else
        log_info "BuildConfig for test-backstage-customization-provider already exists in ${namespace}. Skipping new-app creation."
    fi

    # Expose service
    log_info "Exposing service for test-backstage-customization-provider"
    oc expose svc/test-backstage-customization-provider --namespace="${namespace}" 2>/dev/null || true

    # Wait for build to complete
    log_info "Waiting for build to complete..."
    local build_name
    build_name=$(oc get builds -n "${namespace}" -l buildconfig=test-backstage-customization-provider \
        --sort-by=.metadata.creationTimestamp -o name | tail -1)

    if [[ -n "${build_name}" ]]; then
        oc wait --for=condition=Complete "${build_name}" -n "${namespace}" --timeout=600s || {
            log_warning "Build did not complete in time, checking status..."
            oc get "${build_name}" -n "${namespace}"
        }
    fi

    # Wait for deployment
    wait_for_deployment "${namespace}" "test-backstage-customization-provider" 300
}

# Export functions
export -f base_deployment deploy_redis_cache deploy_test_backstage_customization_provider wait_for_redis_ready monitor_deployment_status