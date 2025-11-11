#!/bin/bash
# Helm deployment functions for RHDH CI/CD Pipeline

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source core modules
# shellcheck source=../../core/k8s.sh
source "${PIPELINES_ROOT}/core/k8s.sh"

# ============================================================================
# Helm Deployment Configuration
# ============================================================================

# Get common Helm set parameters for image configuration
# Usage: get_image_helm_set_params
get_image_helm_set_params() {
  local params=""
  
  # Add image repository
  params+="--set upstream.backstage.image.repository=${QUAY_REPO} "
  
  # Add image tag
  params+="--set upstream.backstage.image.tag=${TAG_NAME} "
  
  echo "${params}"
}

# ---------------------------------------------------------------------------
# Values preprocessing (remove orchestrator plugins when disabled)
# ---------------------------------------------------------------------------

prepare_helm_values() {
  local in_file=$1
  local out_file=$2

  cp "${in_file}" "${out_file}"

  if [[ "${INSTALL_ORCHESTRATOR_PLUGINS:-true}" != "true" ]]; then
    log_info "Removing orchestrator plugins from Helm values (INSTALL_ORCHESTRATOR_PLUGINS=false)"
    if command -v yq &>/dev/null; then
      # delete any element in global.dynamic.plugins array where package contains 'orchestrator'
      yq -i 'del(.global.dynamic.plugins[] | select(.package | test("orchestrator")))' "${out_file}"
    else
      log_warning "yq not found – cannot strip orchestrator plugins."
    fi
  fi
}

# ============================================================================
# Helm Installation/Upgrade
# ============================================================================

# Perform Helm install or upgrade
# Usage: perform_helm_install <release_name> <namespace> <value_file>
perform_helm_install() {
  local release_name=$1
  local namespace=$2
  local value_file=$3
  
  log_info "Performing Helm install/upgrade"
  log_debug "Release: ${release_name}, Namespace: ${namespace}, Values: ${value_file}"
  
  local original_values="${PIPELINES_ROOT}/config/helm-values/${value_file}"
  
  if [[ ! -f "${original_values}" ]]; then
    log_error "Values file not found: ${original_values}"
    return 1
  fi
  
  # Preprocess values (strip orchestrator plugins when disabled)
  local tmp_values
  tmp_values=$(mktemp)
  prepare_helm_values "${original_values}" "${tmp_values}"

  # Build additional helm set arguments
  local extra_sets=""
  if [[ "${INSTALL_ORCHESTRATOR_INFRA:-true}" != "true" ]]; then
    extra_sets="--set orchestrator.enabled=false"
    log_info "Disabling orchestrator in Helm chart (INSTALL_ORCHESTRATOR_INFRA=false)"
  fi

  # shellcheck disable=SC2046,SC2086
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${tmp_values}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params) \
    ${extra_sets}

  rm -f "${tmp_values}"
  
  log_success "Helm installation completed for release: ${release_name}"
}

# ============================================================================
# Kubernetes Resources Application
# ============================================================================

# Apply YAML resource files to a namespace
# Usage: apply_yaml_files <namespace> <rhdh_base_url>
apply_yaml_files() {
  local project=$1
  local rhdh_base_url=$2
  
  log_info "Applying YAML files to namespace ${project}"
  
  oc config set-context --current --namespace="${project}"
  
  local resources_dir="${PIPELINES_ROOT}/config/k8s-resources"
  
  # Update namespace in resource files
  local files=(
    "${resources_dir}/service-accounts/service-account-rhdh.yaml"
    "${resources_dir}/rbac/cluster-role-binding-k8s.yaml"
    "${resources_dir}/rbac/cluster-role-k8s.yaml"
    "${resources_dir}/rbac/cluster-role-ocm.yaml"
  )
  
  for file in "${files[@]}"; do
    if [[ -f "${file}" ]]; then
      sed_inplace "s/namespace:.*/namespace: ${project}/g" "${file}"
    fi
  done
  
  # Encode URLs for secrets
  local dh_target_url=$(echo -n "test-backstage-customization-provider-${project}.${K8S_CLUSTER_ROUTER_BASE}" | base64 | tr -d '\n')
  local rhdh_base_url_encoded=$(echo -n "${rhdh_base_url}" | base64 | tr -d '\n')
  local rhdh_base_url_http=$(echo -n "${rhdh_base_url/https/http}" | base64 | tr -d '\n')
  
  export DH_TARGET_URL="${dh_target_url}"
  export RHDH_BASE_URL="${rhdh_base_url_encoded}"
  export RHDH_BASE_URL_HTTP="${rhdh_base_url_http}"
  
  # Apply service account and secrets
  log_info "Applying service accounts and RBAC resources"
  oc apply -f "${resources_dir}/service-accounts/service-account-rhdh.yaml" --namespace="${project}"
  
  # Apply auth secrets (using envsubst for variable substitution)
  local auth_dir="${PIPELINES_ROOT}/config/k8s-resources/auth"
  if [[ -d "${auth_dir}" ]]; then
    oc apply -f "${auth_dir}/service-account-rhdh-secret.yaml" --namespace="${project}"
  else
    log_warning "Auth directory not found at ${auth_dir}. Skipping auth secrets."
  fi
  
  # Apply RBAC resources
  oc apply -f "${resources_dir}/rbac/cluster-role-k8s.yaml" --namespace="${project}"
  oc apply -f "${resources_dir}/rbac/cluster-role-binding-k8s.yaml" --namespace="${project}"
  oc apply -f "${resources_dir}/rbac/cluster-role-ocm.yaml" --namespace="${project}"
  oc apply -f "${resources_dir}/rbac/cluster-role-binding-ocm.yaml" --namespace="${project}"
  
  # Get OCM cluster token
  local ocm_cluster_token=$(oc get secret rhdh-k8s-plugin-secret -n "${project}" -o=jsonpath='{.data.token}')
  export OCM_CLUSTER_TOKEN="${ocm_cluster_token}"
  
  # Apply RHDH secrets using envsubst
  if [[ -d "${auth_dir}" ]]; then
    envsubst < "${auth_dir}/secrets-rhdh-secrets.yaml" | oc apply --namespace="${project}" -f -
  else
    log_warning "Auth directory not found. Skipping RHDH secrets application."
  fi
  
  # Select and apply appropriate ConfigMap
  local config_file=$(select_config_map_file "${project}")
  create_app_config_map "${config_file}" "${project}"
  
  # Apply dynamic plugins ConfigMap
  log_info "Applying dynamic plugins ConfigMap"
  oc create configmap dynamic-plugins-config \
    --from-file="dynamic-plugins-config.yaml=${resources_dir}/configmaps/dynamic-plugins-config.yaml" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -
  
  # Apply RBAC policy ConfigMap
  log_info "Applying RBAC policy ConfigMap"
  oc create configmap rbac-policy \
    --from-file="rbac-policy.csv=${resources_dir}/configmaps/rbac-policy.csv" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -
  
  # Apply global UI configuration ConfigMaps
  log_info "Applying global UI configuration ConfigMaps"
  oc create configmap dynamic-global-floating-action-button-config \
    --from-file="dynamic-global-floating-action-button-config.yaml=${resources_dir}/configmaps/dynamic-global-floating-action-button-config.yaml" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -
  
  oc create configmap dynamic-global-header-config \
    --from-file="dynamic-global-header-config.yaml=${resources_dir}/configmaps/dynamic-global-header-config.yaml" \
    --namespace="${project}" \
    --dry-run=client -o yaml | oc apply -f -
  
  # Apply Tekton pipeline resources
  log_info "Applying Tekton pipeline resources"
  oc apply -f "${resources_dir}/tekton/hello-world-pipeline.yaml"
  oc apply -f "${resources_dir}/tekton/hello-world-pipeline-run.yaml"
  
  # Apply topology test resources
  log_info "Applying topology test resources"
  oc apply -f "${resources_dir}/topology/topology-test.yaml"
  
  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
    kubectl apply -f "${resources_dir}/topology/topology-test-ingress.yaml"
  else
    oc apply -f "${resources_dir}/topology/topology-test-route.yaml"
  fi
  
  log_success "YAML files applied successfully to namespace ${project}"
}

# Select appropriate ConfigMap file based on namespace
# Usage: select_config_map_file <namespace>
select_config_map_file() {
  local project=$1
  local config_dir="${PIPELINES_ROOT}/config/k8s-resources/configmaps"
  
  # Use explicit list instead of pattern matching to avoid false positives
  case "${project}" in
    # RBAC namespaces - explicitly defined
    "${NAME_SPACE_RBAC}"|"showcase-rbac"|"showcase-rbac-nightly"|"showcase-rbac-k8s-ci-nightly"|"showcase-operator-rbac-nightly")
      log_debug "Selected RBAC config for namespace: ${project}"
      echo "${config_dir}/app-config-rhdh-rbac.yaml"
      ;;
    
    # Base/non-RBAC namespaces - explicitly defined
    "${NAME_SPACE}"|"showcase"|"showcase-ci-nightly"|"showcase-k8s-ci-nightly"|"showcase-operator"|"showcase-operator-nightly"|"showcase-runtime"|"showcase-sanity-plugins"|"showcase-upgrade-nightly")
      log_debug "Selected base config for namespace: ${project}"
      echo "${config_dir}/app-config-rhdh.yaml"
      ;;
    
    # Default case - if namespace contains 'rbac', use RBAC config, otherwise use base config
    *)
      if [[ "${project}" == *rbac* ]]; then
        log_warning "Unknown namespace '${project}' matches RBAC pattern. Using RBAC config."
        echo "${config_dir}/app-config-rhdh-rbac.yaml"
      else
        log_warning "Unknown namespace '${project}'. Using default base config."
        echo "${config_dir}/app-config-rhdh.yaml"
      fi
      ;;
  esac
}

# ============================================================================
# Test Backstage Customization Provider
# ============================================================================

# Deploy test backstage customization provider
# Usage: deploy_test_backstage_customization_provider <namespace>
deploy_test_backstage_customization_provider() {
  local project=$1
  
  log_info "Deploying test-backstage-customization-provider in namespace ${project}"
  
  # Check if the buildconfig already exists
  if ! oc get buildconfig test-backstage-customization-provider -n "${project}" > /dev/null 2>&1; then
    log_info "Creating new app for test-backstage-customization-provider"
    oc new-app -S openshift/nodejs:18-minimal-ubi8
    oc new-app https://github.com/janus-qe/test-backstage-customization-provider \
      --image-stream="openshift/nodejs:18-ubi8" \
      --namespace="${project}"
  else
    log_info "BuildConfig already exists in ${project}. Skipping new-app creation"
  fi
  
  log_info "Exposing service for test-backstage-customization-provider"
  oc expose svc/test-backstage-customization-provider --namespace="${project}"
  
  log_success "Test backstage customization provider deployed"
}

# ============================================================================
# Redis Cache Deployment
# ============================================================================

# Deploy Redis cache
# Usage: deploy_redis_cache <namespace>
deploy_redis_cache() {
  local namespace=$1
  local resources_dir="${PIPELINES_ROOT}/config/k8s-resources/redis"
  
  log_info "Deploying Redis cache in namespace: ${namespace}"
  
  envsubst < "${resources_dir}/redis-secret.yaml" | oc apply --namespace="${namespace}" -f -
  oc apply -f "${resources_dir}/redis-deployment.yaml" --namespace="${namespace}"
  
  log_success "Redis cache deployed successfully"
}

# ============================================================================
# PostgreSQL Database Configuration
# ============================================================================

# Configure external PostgreSQL database
# Usage: configure_external_postgres_db <namespace>
configure_external_postgres_db() {
  local project=$1
  local resources_dir="${PIPELINES_ROOT}/config/k8s-resources/postgres"
  
  log_info "Configuring external PostgreSQL database"
  
  # Apply PostgreSQL resources
  oc apply -f "${resources_dir}/postgres.yaml" --namespace="${NAME_SPACE_POSTGRES_DB}"
  sleep 5
  
  # Extract certificates to a temporary directory (avoid leaving files in repo)
  local tmpdir
  tmpdir=$(mktemp -d)
  log_debug "Using tmpdir ${tmpdir} for PG TLS artifacts"

  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" \
    -o jsonpath='{.data.ca\.crt}'   | base64 --decode > "${tmpdir}/ca.crt"
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" \
    -o jsonpath='{.data.tls\.crt}' | base64 --decode > "${tmpdir}/tls.crt"
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" \
    -o jsonpath='{.data.tls\.key}' | base64 --decode > "${tmpdir}/tls.key"

  # Create / update secret in target namespace with the extracted files
  oc create secret generic postgress-external-db-cluster-cert \
    --from-file=ca.crt="${tmpdir}/ca.crt" \
    --from-file=tls.crt="${tmpdir}/tls.crt" \
    --from-file=tls.key="${tmpdir}/tls.key" \
    --dry-run=client -o yaml | oc apply -f - --namespace="${project}"

  # Clean up temporary directory
  rm -rf "${tmpdir}"
  
  # Update PostgreSQL credentials
  local postgres_password=$(oc get secret/postgress-external-db-pguser-janus-idp \
    -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.password}')
  sed_inplace "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${postgres_password}|g" \
    "${resources_dir}/postgres-cred.yaml"
  
  local postgres_host=$(echo -n "postgress-external-db-primary.${NAME_SPACE_POSTGRES_DB}.svc.cluster.local" | \
    base64 | tr -d '\n')
  sed_inplace "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${postgres_host}|g" \
    "${resources_dir}/postgres-cred.yaml"
  
  oc apply -f "${resources_dir}/postgres-cred.yaml" --namespace="${project}"
  
  log_success "External PostgreSQL database configured"
}

# ============================================================================
# Orchestrator Workflows Deployment
# ============================================================================

# Deploy orchestrator workflows for testing
# Usage: deploy_orchestrator_workflows <namespace>
deploy_orchestrator_workflows() {
  local namespace=$1
  
  log_info "Deploying orchestrator workflows in namespace: ${namespace}"
  
  local workflow_repo="https://github.com/rhdh-orchestrator-test/serverless-workflows.git"
  local workflow_dir="${PIPELINES_ROOT}/serverless-workflows"
  local workflow_manifests="${workflow_dir}/workflows/experimentals/user-onboarding/manifests/"
  
  # Clone workflows repository
  rm -rf "${workflow_dir}"
  git clone "${workflow_repo}" "${workflow_dir}"
  
  # Determine PostgreSQL configuration based on namespace
  if [[ "${namespace}" == "${NAME_SPACE_RBAC}" ]]; then
    local pqsl_secret_name="postgres-cred"
    local pqsl_user_key="POSTGRES_USER"
    local pqsl_password_key="POSTGRES_PASSWORD"
    local pqsl_svc_name="postgress-external-db-primary"
    local patch_namespace="${NAME_SPACE_POSTGRES_DB}"
  else
    local pqsl_secret_name="rhdh-postgresql-svcbind-postgres"
    local pqsl_user_key="username"
    local pqsl_password_key="password"
    local pqsl_svc_name="rhdh-postgresql"
    local patch_namespace="${namespace}"
  fi
  
  # Apply workflow manifests
  oc apply -f "${workflow_manifests}"
  
  # Install greeting workflow via Helm
  log_info "Installing greeting workflow via Helm"
  helm repo add orchestrator-workflows https://rhdhorchestrator.io/serverless-workflows 2>/dev/null || true
  helm install greeting orchestrator-workflows/greeting -n "${namespace}"
  
  # Wait for SonataFlow resources
  log_info "Waiting for SonataFlow resources to be created"
  until [[ $(oc get sf -n "${namespace}" --no-headers 2> /dev/null | wc -l) -eq 2 ]]; do
    log_debug "Waiting for sf resources... Retrying in 5 seconds"
    sleep 5
  done
  
  # Patch workflows with PostgreSQL configuration
  log_info "Patching workflows with PostgreSQL configuration"
  for workflow in greeting user-onboarding; do
    oc -n "${namespace}" patch sonataflow "${workflow}" --type merge \
      -p "{\"spec\": { \"persistence\": { \"postgresql\": { \"secretRef\": {\"name\": \"${pqsl_secret_name}\",\"userKey\": \"${pqsl_user_key}\",\"passwordKey\": \"${pqsl_password_key}\"},\"serviceRef\": {\"name\": \"${pqsl_svc_name}\",\"namespace\": \"${patch_namespace}\"}}}}}"
  done
  
  log_success "Orchestrator workflows deployed successfully"
}

# ============================================================================
# Complete Deployment Functions
# ============================================================================

# Deploy base RHDH instance
# Usage: base_deployment
base_deployment() {
  log_section "Base RHDH Deployment"
  
  configure_namespace "${NAME_SPACE}"
  
  deploy_redis_cache "${NAME_SPACE}"
  
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${NAME_SPACE}" "${rhdh_base_url}"
  
  log_info "Deploying image from repository: ${QUAY_REPO}, TAG: ${TAG_NAME}"
  perform_helm_install "${RELEASE_NAME}" "${NAME_SPACE}" "${HELM_CHART_VALUE_FILE_NAME}"
  
  # Deploy orchestrator workflows if enabled
  if [[ "${DEPLOY_ORCHESTRATOR_WORKFLOWS:-true}" == "true" ]]; then
    deploy_orchestrator_workflows "${NAME_SPACE}"
  else
    log_info "Skipping orchestrator workflows deployment (DEPLOY_ORCHESTRATOR_WORKFLOWS=false)"
  fi
  
  log_success "Base deployment completed"
}

# Deploy RBAC RHDH instance
# Usage: rbac_deployment
rbac_deployment() {
  log_section "RBAC RHDH Deployment"
  
  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"
  
  # Deploy RBAC instance
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  
  log_info "Deploying RBAC image from repository: ${QUAY_REPO}, TAG: ${TAG_NAME}"
  perform_helm_install "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${HELM_CHART_RBAC_VALUE_FILE_NAME}"
  
  # Configure SonataFlow platform if orchestrator is enabled
  if [[ "${INSTALL_ORCHESTRATOR_INFRA:-true}" == "true" ]]; then
    # Workaround: Allow sonataflow platform to connect to external postgres db using SSL
    log_info "Configuring SonataFlow platform for external PostgreSQL"
    until [[ $(oc get jobs -n "${NAME_SPACE_RBAC}" 2> /dev/null | \
      grep "${RELEASE_NAME_RBAC}-create-sonataflow-database" | wc -l) -eq 1 ]]; do
      log_debug "Waiting for sf db creation job... Retrying in 5 seconds"
      sleep 5
    done
    
    oc wait --for=condition=complete "job/${RELEASE_NAME_RBAC}-create-sonataflow-database" \
      -n "${NAME_SPACE_RBAC}" --timeout=3m
    
    oc -n "${NAME_SPACE_RBAC}" patch sfp sonataflow-platform --type=merge \
      -p '{"spec":{"services":{"jobService":{"podTemplate":{"container":{"env":[{"name":"QUARKUS_DATASOURCE_REACTIVE_URL","value":"postgresql://postgress-external-db-primary.postgress-external-db.svc.cluster.local:5432/sonataflow?search_path=jobs-service&sslmode=require&ssl=true&trustAll=true"},{"name":"QUARKUS_DATASOURCE_REACTIVE_SSL_MODE","value":"require"},{"name":"QUARKUS_DATASOURCE_REACTIVE_TRUST_ALL","value":"true"}]}}}}}}'
    
    oc rollout restart deployment/sonataflow-platform-jobs-service -n "${NAME_SPACE_RBAC}"
  else
    log_info "Skipping SonataFlow platform configuration (INSTALL_ORCHESTRATOR_INFRA=false)"
  fi
  
  # Deploy orchestrator workflows if enabled
  if [[ "${DEPLOY_ORCHESTRATOR_WORKFLOWS:-true}" == "true" ]]; then
    deploy_orchestrator_workflows "${NAME_SPACE_RBAC}"
  else
    log_info "Skipping orchestrator workflows deployment (DEPLOY_ORCHESTRATOR_WORKFLOWS=false)"
  fi
  
  log_success "RBAC deployment completed"
}

# Initiate both base and RBAC deployments
# Usage: initiate_deployments
initiate_deployments() {
  log_section "Initiating All Deployments"
  
  base_deployment
  rbac_deployment
  
  log_success "All deployments initiated successfully"
}

# ============================================================================
# Export Functions
# ============================================================================
export -f get_image_helm_set_params
export -f perform_helm_install
export -f apply_yaml_files
export -f select_config_map_file
export -f deploy_test_backstage_customization_provider
export -f deploy_redis_cache
export -f configure_external_postgres_db
export -f deploy_orchestrator_workflows
export -f base_deployment
export -f rbac_deployment
export -f initiate_deployments

