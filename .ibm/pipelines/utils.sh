#!/bin/bash

# shellcheck source=.ibm/pipelines/reporting.sh
source "${DIR}/reporting.sh"
# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ibm/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"
# shellcheck source=.ibm/pipelines/lib/operators.sh
source "${DIR}/lib/operators.sh"
# shellcheck source=.ibm/pipelines/lib/k8s-wait.sh
source "${DIR}/lib/k8s-wait.sh"
# shellcheck source=.ibm/pipelines/lib/orchestrator.sh
source "${DIR}/lib/orchestrator.sh"
# shellcheck source=.ibm/pipelines/lib/helm.sh
source "${DIR}/lib/helm.sh"
# shellcheck source=.ibm/pipelines/lib/namespace.sh
source "${DIR}/lib/namespace.sh"
# shellcheck source=.ibm/pipelines/lib/config.sh
source "${DIR}/lib/config.sh"
# shellcheck source=.ibm/pipelines/lib/testing.sh
source "${DIR}/lib/testing.sh"

# Constants
TEKTON_PIPELINES_WEBHOOK="tekton-pipelines-webhook"

# Override GitHub App env vars (showcase and RBAC) with prefixed versions for the same pair index.
# Usage: override_github_app_env_with_prefix <PREFIX>
# Example: override_github_app_env_with_prefix 3
# Replaces GITHUB_APP_APP_ID (and CLIENT_ID, PRIVATE_KEY, CLIENT_SECRET, WEBHOOK_URL, WEBHOOK_SECRET) from _${PREFIX}.
# Replaces GITHUB_APP_APP_ID_RBAC (and same set with _RBAC) from _RBAC_${PREFIX}.
# If any of the prefixed vars is empty, leaves the original envs unchanged.
override_github_app_env_with_prefix() {
  local prefix="$1"
  [[ -n "${prefix}" ]] || return 0

  local app_id_var="GITHUB_APP_APP_ID_${prefix}"
  local client_id_var="GITHUB_APP_CLIENT_ID_${prefix}"
  local private_key_var="GITHUB_APP_PRIVATE_KEY_${prefix}"
  local client_secret_var="GITHUB_APP_CLIENT_SECRET_${prefix}"
  local webhook_url_var="GITHUB_APP_WEBHOOK_URL_${prefix}"
  local webhook_secret_var="GITHUB_APP_WEBHOOK_SECRET_${prefix}"

  local app_id_rbac_var="GITHUB_APP_APP_ID_RBAC_${prefix}"
  local client_id_rbac_var="GITHUB_APP_CLIENT_ID_RBAC_${prefix}"
  local private_key_rbac_var="GITHUB_APP_PRIVATE_KEY_RBAC_${prefix}"
  local client_secret_rbac_var="GITHUB_APP_CLIENT_SECRET_RBAC_${prefix}"
  local webhook_url_rbac_var="GITHUB_APP_WEBHOOK_URL_RBAC_${prefix}"
  local webhook_secret_rbac_var="GITHUB_APP_WEBHOOK_SECRET_RBAC_${prefix}"

  if [[ -n "${!app_id_var:-}" ]] && [[ -n "${!client_id_var:-}" ]] && \
     [[ -n "${!private_key_var:-}" ]] && [[ -n "${!client_secret_var:-}" ]] && \
     [[ -n "${!webhook_url_var:-}" ]] && [[ -n "${!webhook_secret_var:-}" ]]; then
    log::info "Overriding showcase env vars (GITHUB_APP_APP_ID, CLIENT_ID, PRIVATE_KEY, CLIENT_SECRET, WEBHOOK_URL, WEBHOOK_SECRET) with values from _${prefix}"
    GITHUB_APP_APP_ID="${!app_id_var}"
    GITHUB_APP_CLIENT_ID="${!client_id_var}"
    GITHUB_APP_PRIVATE_KEY="${!private_key_var}"
    GITHUB_APP_CLIENT_SECRET="${!client_secret_var}"
    GITHUB_APP_WEBHOOK_URL="${!webhook_url_var}"
    GITHUB_APP_WEBHOOK_SECRET="${!webhook_secret_var}"
    export GITHUB_APP_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_PRIVATE_KEY GITHUB_APP_CLIENT_SECRET GITHUB_APP_WEBHOOK_URL GITHUB_APP_WEBHOOK_SECRET
  else
    log::info "Not overriding showcase GitHub App env vars with prefix ${prefix}: one or more of ${app_id_var}, ${client_id_var}, ${private_key_var}, ${client_secret_var}, ${webhook_url_var}, ${webhook_secret_var} is empty"
  fi

  if [[ -n "${!app_id_rbac_var:-}" ]] && [[ -n "${!client_id_rbac_var:-}" ]] && \
     [[ -n "${!private_key_rbac_var:-}" ]] && [[ -n "${!client_secret_rbac_var:-}" ]] && \
     [[ -n "${!webhook_url_rbac_var:-}" ]] && [[ -n "${!webhook_secret_rbac_var:-}" ]]; then
    log::info "Overriding RBAC env vars (GITHUB_APP_APP_ID_RBAC, CLIENT_ID_RBAC, PRIVATE_KEY_RBAC, CLIENT_SECRET_RBAC, WEBHOOK_URL_RBAC, WEBHOOK_SECRET_RBAC) with values from _RBAC_${prefix}"
    GITHUB_APP_APP_ID_RBAC="${!app_id_rbac_var}"
    GITHUB_APP_CLIENT_ID_RBAC="${!client_id_rbac_var}"
    GITHUB_APP_PRIVATE_KEY_RBAC="${!private_key_rbac_var}"
    GITHUB_APP_CLIENT_SECRET_RBAC="${!client_secret_rbac_var}"
    GITHUB_APP_WEBHOOK_URL_RBAC="${!webhook_url_rbac_var}"
    GITHUB_APP_WEBHOOK_SECRET_RBAC="${!webhook_secret_rbac_var}"
    export GITHUB_APP_APP_ID_RBAC GITHUB_APP_CLIENT_ID_RBAC GITHUB_APP_PRIVATE_KEY_RBAC GITHUB_APP_CLIENT_SECRET_RBAC GITHUB_APP_WEBHOOK_URL_RBAC GITHUB_APP_WEBHOOK_SECRET_RBAC
  else
    log::info "Not overriding RBAC GitHub App env vars with prefix ${prefix}: one or more of ${app_id_rbac_var}, ${client_id_rbac_var}, ${private_key_rbac_var}, ${client_secret_rbac_var}, ${webhook_url_rbac_var}, ${webhook_secret_rbac_var} is empty"
  fi
}

retrieve_pod_logs() {
  local pod_name=$1
  local container=$2
  local namespace=$3
  local log_timeout=${4:-5} # Default timeout: 5 seconds (reduced from 30s to speed up failure cases)
  log::debug "Retrieving logs for container: $container"
  # Save logs for the current and previous container with timeout to prevent hanging
  timeout "${log_timeout}" kubectl logs "$pod_name" -c "$container" -n "$namespace" > "pod_logs/${pod_name}_${container}.log" 2> /dev/null || { log::warn "logs for container $container not found or timed out"; }
  timeout "${log_timeout}" kubectl logs "$pod_name" -c "$container" -n "$namespace" --previous > "pod_logs/${pod_name}_${container}-previous.log" 2> /dev/null || {
    log::debug "Previous logs for container $container not found or timed out"
    rm -f "pod_logs/${pod_name}_${container}-previous.log"
  }
}

save_all_pod_logs() {
  set +e
  local namespace=$1
  rm -rf pod_logs && mkdir -p pod_logs

  # Get all pod names in the namespace
  pod_names=$(kubectl get pods -n $namespace -o jsonpath='{.items[*].metadata.name}')
  for pod_name in $pod_names; do
    log::debug "Retrieving logs for pod: $pod_name in namespace $namespace"

    init_containers=$(kubectl get pod $pod_name -n $namespace -o jsonpath='{.spec.initContainers[*].name}')
    # Loop through each init container and retrieve logs
    for init_container in $init_containers; do
      retrieve_pod_logs $pod_name $init_container $namespace
    done

    containers=$(kubectl get pod $pod_name -n $namespace -o jsonpath='{.spec.containers[*].name}')
    for container in $containers; do
      retrieve_pod_logs $pod_name $container $namespace
    done
  done

  mkdir -p "${ARTIFACT_DIR}/${namespace}/pod_logs"
  cp -a pod_logs/* "${ARTIFACT_DIR}/${namespace}/pod_logs" || true
  set -e
}

# ==============================================================================
# Orchestrator Functions - Delegate to lib/orchestrator.sh
# ==============================================================================
should_skip_orchestrator() { orchestrator::should_skip; }

disable_orchestrator_plugins_in_values() {
  orchestrator::disable_plugins_in_values "$@"
  return $?
}

# ==============================================================================
# Operator Functions - Delegate to lib/operators.sh
# ==============================================================================
install_subscription() { operator::install_subscription "$@"; }

check_operator_status() { operator::check_status "$@"; }

# Installs the Crunchy Postgres Operator
# Args: platform ("ocp" or "k8s", default: "ocp")
install_crunchy_postgres_operator() {
  local platform=${1:-ocp}
  install_subscription crunchy-postgres-operator openshift-operators v5 crunchy-postgres-operator certified-operators openshift-marketplace
}

# Waits for the Crunchy Postgres Operator to be ready
# Args: platform ("ocp" or "k8s", default: "ocp")
waitfor_crunchy_postgres_operator() {
  local platform=${1:-ocp}
  local namespace="openshift-operators"
  [[ "$platform" == "k8s" ]] && namespace="operators"

  check_operator_status 300 "$namespace" "Crunchy Postgres for Kubernetes" "Succeeded"
  k8s_wait::crd "postgresclusters.postgres-operator.crunchydata.com" 120 5 || return 1
}

# Backward compatibility shims
install_crunchy_postgres_ocp_operator() { install_crunchy_postgres_operator "ocp"; }
install_crunchy_postgres_k8s_operator() { install_crunchy_postgres_operator "k8s"; }
waitfor_crunchy_postgres_ocp_operator() { waitfor_crunchy_postgres_operator "ocp"; }
waitfor_crunchy_postgres_k8s_operator() { waitfor_crunchy_postgres_operator "k8s"; }

configure_external_postgres_db() {
  local project=$1
  local max_attempts=60 # 5 minutes total (60 attempts × 5 seconds)
  local wait_interval=5

  log::info "Creating PostgresCluster in namespace ${NAME_SPACE_POSTGRES_DB}..."

  # Validate oc apply command execution
  if ! oc apply -f "${DIR}/resources/postgres-db/postgres.yaml" --namespace="${NAME_SPACE_POSTGRES_DB}"; then
    log::error "Failed to create PostgresCluster"
    return 1
  fi

  # Wait for cluster cert secret (usually created quickly)
  log::info "Waiting for cluster certificate secret..."
  if ! common::poll_until \
    "oc get secret postgress-external-db-cluster-cert -n '${NAME_SPACE_POSTGRES_DB}'" \
    "$max_attempts" "$wait_interval" \
    "Cluster certificate secret found"; then
    return 1
  fi

  # Extract cluster certificates
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.ca\.crt}' | base64 --decode > postgres-ca
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.crt}' | base64 --decode > postgres-tls-crt
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.key}' | base64 --decode > postgres-tls-key

  # Validate secret creation
  if ! oc create secret generic postgress-external-db-cluster-cert \
    --from-file=ca.crt=postgres-ca \
    --from-file=tls.crt=postgres-tls-crt \
    --from-file=tls.key=postgres-tls-key \
    --dry-run=client -o yaml | oc apply -f - --namespace="${project}"; then
    log::error "Failed to create cluster certificate secret"
    return 1
  fi

  # Wait for USER secret (this is the critical one that causes CI failures!)
  log::info "Waiting for PostgreSQL user secret 'postgress-external-db-pguser-janus-idp'..."
  log::info "This secret is created by the Crunchy Postgres operator after the database is ready"
  if ! common::poll_until \
    "oc get secret postgress-external-db-pguser-janus-idp -n '${NAME_SPACE_POSTGRES_DB}'" \
    "$max_attempts" "$wait_interval" \
    "PostgreSQL user secret found"; then
    log::error "This usually means the Crunchy Postgres operator failed to create the user"
    log::info "Checking PostgresCluster status..."
    oc describe postgrescluster postgress-external-db -n "${NAME_SPACE_POSTGRES_DB}" || true
    log::info "Checking operator logs..."
    oc logs -n "${NAME_SPACE_POSTGRES_DB}" -l postgres-operator.crunchydata.com/cluster=postgress-external-db --tail=50 || true
    return 1
  fi

  # Now we can safely get the password
  POSTGRES_PASSWORD=$(oc get secret/postgress-external-db-pguser-janus-idp -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.password}')
  common::sed_inplace "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  POSTGRES_HOST=$(common::base64_encode "postgress-external-db-primary.$NAME_SPACE_POSTGRES_DB.svc.cluster.local")
  common::sed_inplace "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${POSTGRES_HOST}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"

  # Validate final configuration apply
  if ! oc apply -f "${DIR}/resources/postgres-db/postgres-cred.yaml" --namespace="${project}"; then
    log::error "Failed to apply PostgreSQL credentials"
    return 1
  fi

  log::success "External PostgreSQL database configured successfully!"
}

apply_yaml_files() {
  local dir=$1
  local project=$2
  local rhdh_base_url=$3
  log::info "Applying YAML files to namespace ${project}"

  oc config set-context --current --namespace="${project}"

  local files=(
    "$dir/resources/service_account/service-account-rhdh.yaml"
    "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml"
    "$dir/resources/cluster_role/cluster-role-k8s.yaml"
  )

  for file in "${files[@]}"; do
    common::sed_inplace "s/namespace:.*/namespace: ${project}/g" "$file"
  done

  DH_TARGET_URL=$(common::base64_encode "test-backstage-customization-provider-${project}.${K8S_CLUSTER_ROUTER_BASE}")
  RHDH_BASE_URL=$(common::base64_encode "$rhdh_base_url")
  RHDH_BASE_URL_HTTP=$(common::base64_encode "${rhdh_base_url/https/http}")
  export DH_TARGET_URL RHDH_BASE_URL RHDH_BASE_URL_HTTP

  oc apply -f "$dir/resources/service_account/service-account-rhdh.yaml" --namespace="${project}"
  oc apply -f "$dir/auth/service-account-rhdh-secret.yaml" --namespace="${project}"

  oc apply -f "$dir/resources/cluster_role/cluster-role-k8s.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml" --namespace="${project}"

  envsubst < "${DIR}/auth/secrets-rhdh-secrets.yaml" | oc apply --namespace="${project}" -f -

  # Select the configuration file based on the namespace or job
  config_file=$(config::select_config_map_file "$project" "$dir")
  # Apply the ConfigMap with the correct file
  config::create_app_config_map "$config_file" "$project"

  common::create_configmap_from_file "dynamic-plugins-config" "$project" \
    "dynamic-plugins-config.yaml" "$dir/resources/config_map/dynamic-plugins-config.yaml"

  if [[ "$JOB_NAME" == *operator* ]] && [[ "${project}" == *rbac* ]]; then
    common::create_configmap_from_files "rbac-policy" "$project" \
      "rbac-policy.csv=$dir/resources/config_map/rbac-policy.csv" \
      "conditional-policies.yaml=/tmp/conditional-policies.yaml"
  else
    common::create_configmap_from_files "rbac-policy" "$project" \
      "rbac-policy.csv=$dir/resources/config_map/rbac-policy.csv" \
      "conditional-policies.yaml=$dir/resources/config_map/conditional-policies.yaml"
  fi

  # configuration for testing global floating action button.
  common::create_configmap_from_file "dynamic-global-floating-action-button-config" "$project" \
    "dynamic-global-floating-action-button-config.yaml" "$dir/resources/config_map/dynamic-global-floating-action-button-config.yaml"

  # configuration for testing global header and header mount points.
  common::create_configmap_from_file "dynamic-global-header-config" "$project" \
    "dynamic-global-header-config.yaml" "$dir/resources/config_map/dynamic-global-header-config.yaml"

  # Skip Tekton and Topology resources for K8s deployments (AKS/EKS/GKE)
  # Tekton tests are not executed in showcase-k8s or showcase-rbac-k8s projects
  if [[ "$JOB_NAME" != *"aks"* && "$JOB_NAME" != *"eks"* && "$JOB_NAME" != *"gke"* ]]; then
    # Create Pipeline run for tekton test case.
    oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline.yaml"
    oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline-run.yaml"

    # Create Deployment and Pipeline for Topology test.
    oc apply -f "$dir/resources/topology_test/topology-test.yaml"
    if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
      kubectl apply -f "$dir/resources/topology_test/topology-test-ingress.yaml"
    else
      oc apply -f "$dir/resources/topology_test/topology-test-route.yaml"
    fi
  else
    log::info "Skipping Tekton Pipeline and Topology resources for K8s deployment (${JOB_NAME})"
  fi
}

deploy_test_backstage_customization_provider() {
  local project=$1
  log::info "Deploying test-backstage-customization-provider in namespace ${project}"

  # Check if the buildconfig already exists
  if ! oc get buildconfig test-backstage-customization-provider -n "${project}" > /dev/null 2>&1; then
    # Get latest nodejs UBI9 tag from cluster, fallback to 18-ubi8
    local nodejs_tag
    nodejs_tag=$(oc get imagestream nodejs -n openshift -o jsonpath='{.spec.tags[*].name}' 2> /dev/null \
      | tr ' ' '\n' | grep -E '^[0-9]+-ubi9$' | sort -t'-' -k1 -n | tail -1)
    nodejs_tag="${nodejs_tag:-18-ubi8}"
    log::info "Creating new app for test-backstage-customization-provider using nodejs:${nodejs_tag}"
    oc new-app "openshift/nodejs:${nodejs_tag}~https://github.com/janus-qe/test-backstage-customization-provider" --namespace="${project}"
  else
    log::warn "BuildConfig for test-backstage-customization-provider already exists in ${project}. Skipping new-app creation."
  fi

  log::info "Exposing service for test-backstage-customization-provider"
  oc expose svc/test-backstage-customization-provider --namespace="${project}"
}

deploy_redis_cache() {
  local namespace=$1
  envsubst < "$DIR/resources/redis-cache/redis-secret.yaml" | oc apply --namespace="${namespace}" -f -
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${namespace}"
}

# OLM Functions - Delegate to lib/operators.sh
install_olm() { operator::install_olm "$@"; }
uninstall_olm() { operator::uninstall_olm "$@"; }

# Installs the Red Hat OpenShift Pipelines operator if not already installed
# Use waitfor_pipelines_operator to wait for the operator to be ready
install_pipelines_operator() {
  local display_name="Red Hat OpenShift Pipelines"
  # Check if operator is already installed
  if oc get csv -n "openshift-operators" | grep -q "${display_name}"; then
    log::warn "Red Hat OpenShift Pipelines operator is already installed."
  else
    log::info "Red Hat OpenShift Pipelines operator is not installed. Installing..."
    install_subscription openshift-pipelines-operator openshift-operators latest openshift-pipelines-operator-rh redhat-operators openshift-marketplace
  fi
  # Wait for Tekton Pipeline CRD to be registered before proceeding
  k8s_wait::crd "pipelines.tekton.dev" 120 5 || return 1
}

waitfor_pipelines_operator() {
  k8s_wait::deployment "openshift-operators" "pipelines"
  k8s_wait::endpoint "tekton-pipelines-webhook" "openshift-pipelines"
}

# Installs the Tekton Pipelines if not already installed (alternative of OpenShift Pipelines for Kubernetes clusters)
# Use waitfor_tekton_pipelines to wait for the operator to be ready
install_tekton_pipelines() {
  local display_name="tekton-pipelines-webhook"
  if oc get pods -n "tekton-pipelines" | grep -q "${display_name}"; then
    log::info "Tekton Pipelines are already installed."
  else
    log::info "Tekton Pipelines is not installed. Installing..."
    kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
  fi
}

waitfor_tekton_pipelines() {
  local display_name="tekton-pipelines-webhook"
  k8s_wait::deployment "tekton-pipelines" "${display_name}"
  k8s_wait::endpoint "tekton-pipelines-webhook" "tekton-pipelines"
  k8s_wait::crd "pipelines.tekton.dev" 120 5 || return 1
}

delete_tekton_pipelines() {
  log::info "Checking for Tekton Pipelines installation..."
  if ! kubectl get namespace tekton-pipelines &> /dev/null; then
    log::info "Tekton Pipelines is not installed. Nothing to delete."
    return 0
  fi

  log::info "Found Tekton Pipelines installation. Attempting to delete..."
  kubectl delete -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml --ignore-not-found=true 2> /dev/null || true

  # Wait for namespace deletion with polling
  log::info "Waiting for Tekton Pipelines namespace to be deleted..."
  if common::poll_until \
    "! kubectl get namespace tekton-pipelines" \
    6 5 \
    "Tekton Pipelines deleted successfully"; then
    return 0
  fi
  log::warn "Timed out waiting for namespace deletion, continuing..."
}

# ==============================================================================
# Cluster Setup Functions
# These functions configure the cluster for different deployment types
# Orchestrator functions are delegated to lib/orchestrator.sh
# ==============================================================================

install_orchestrator_infra_chart() {
  orchestrator::install_infra_chart
  return $?
}

deploy_orchestrator_workflows() {
  orchestrator::deploy_workflows "$@"
  return $?
}

deploy_orchestrator_workflows_operator() {
  orchestrator::deploy_workflows_operator "$@"
  return $?
}

enable_orchestrator_plugins_op() {
  orchestrator::enable_plugins_operator "$@"
  return $?
}

cluster_setup_ocp_helm() {
  operator::install_pipelines

  # Wait for OpenShift Pipelines to be ready before proceeding
  log::info "Waiting for OpenShift Pipelines to be ready..."
  k8s_wait::deployment "${OPERATOR_NAMESPACE}" "pipelines" 30 10 || return 1
  k8s_wait::endpoint "${TEKTON_PIPELINES_WEBHOOK}" "openshift-pipelines" 1800 10 || return 1

  operator::install_postgres_ocp

  # Skip orchestrator infra installation based on job type (see should_skip_orchestrator)
  if should_skip_orchestrator; then
    echo "Skipping orchestrator-infra installation on this job: ${JOB_NAME}"
  else
    install_orchestrator_infra_chart
  fi
}

cluster_setup_ocp_operator() {
  operator::install_pipelines

  # Wait for OpenShift Pipelines to be ready before proceeding
  log::info "Waiting for OpenShift Pipelines to be ready..."
  k8s_wait::deployment "${OPERATOR_NAMESPACE}" "pipelines" 30 10 || return 1
  k8s_wait::endpoint "${TEKTON_PIPELINES_WEBHOOK}" "openshift-pipelines" 1800 10 || return 1

  operator::install_postgres_ocp
  operator::install_serverless
  operator::install_serverless_logic
}

cluster_setup_k8s_operator() {
  operator::install_olm
  # Tekton not installed for K8s deployments (AKS/EKS/GKE)
  # Tekton tests are not executed in showcase-k8s or showcase-rbac-k8s projects
  # operator::install_tekton
  # operator::install_postgres_k8s # Works with K8s but disabled in values file
}

cluster_setup_k8s_helm() {
  # Tekton not installed for K8s deployments (AKS/EKS/GKE)
  # Tekton tests are not executed in showcase-k8s or showcase-rbac-k8s projects
  log::info "Skipping Tekton installation for K8s Helm deployment"
  # operator::install_olm
  # operator::install_tekton
  # operator::install_postgres_k8s # Works with K8s but disabled in values file
}

# ==============================================================================
# FUTURE MODULE: lib/deployment.sh
# Functions: base_deployment, rbac_deployment, initiate_deployments,
#            base_deployment_osd_gcp, rbac_deployment_osd_gcp, initiate_deployments_osd_gcp,
#            initiate_upgrade_base_deployments, initiate_upgrade_deployments,
#            initiate_runtime_deployment, initiate_sanity_plugin_checks_deployment,
#            apply_yaml_files, deploy_test_backstage_customization_provider,
#            deploy_redis_cache, configure_external_postgres_db
# ==============================================================================

base_deployment() {
  namespace::configure ${NAME_SPACE}

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}"
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  if should_skip_orchestrator; then
    local merged_pr_value_file="/tmp/merged-values_showcase_PR.yaml"
    helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase_PR.yaml" "${merged_pr_value_file}"
    disable_orchestrator_plugins_in_values "${merged_pr_value_file}"

    mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE}"
    cp -a "${merged_pr_value_file}" "${ARTIFACT_DIR}/${NAME_SPACE}/" || true
    # shellcheck disable=SC2046
    helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
      "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
      -f "${merged_pr_value_file}" \
      --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
      $(helm::get_image_params)
  else
    helm::install "${RELEASE_NAME}" "${NAME_SPACE}" "${HELM_CHART_VALUE_FILE_NAME}"
  fi

  if should_skip_orchestrator; then
    log::warn "Skipping orchestrator workflows deployment on PR job: ${JOB_NAME}"
  else
    deploy_orchestrator_workflows "${NAME_SPACE}"
  fi
}

rbac_deployment() {
  namespace::configure "${NAME_SPACE_POSTGRES_DB}"
  namespace::configure "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  # Wait for PostgreSQL to be fully ready before deploying RBAC instance
  # This ensures the sonataflow database creation job can connect immediately
  log::info "Waiting for external PostgreSQL to be ready..."
  if ! k8s_wait::deployment "${NAME_SPACE_POSTGRES_DB}" "postgress-external-db" 10 10; then
    log::error "PostgreSQL deployment failed to become ready"
    return 1
  fi

  # Initiate rbac instance deployment.
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"
  if should_skip_orchestrator; then
    local merged_pr_rbac_value_file="/tmp/merged-values_showcase-rbac_PR.yaml"
    helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase-rbac_PR.yaml" "${merged_pr_rbac_value_file}"
    disable_orchestrator_plugins_in_values "${merged_pr_rbac_value_file}"

    mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
    cp -a "${merged_pr_rbac_value_file}" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" || true
    # shellcheck disable=SC2046
    helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
      "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
      -f "${merged_pr_rbac_value_file}" \
      --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
      $(helm::get_image_params)
  else
    helm::install "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${HELM_CHART_RBAC_VALUE_FILE_NAME}"
  fi

  # NOTE: This is a workaround to allow the sonataflow platform to connect to the external postgres db using ssl.
  if should_skip_orchestrator; then
    log::warn "Skipping sonataflow (orchestrator) external DB SSL workaround on PR job: ${JOB_NAME}"
  else
    # Wait for the sonataflow database creation job to complete with robust error handling
    if ! k8s_wait::job "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}-create-sonataflow-database" 10 10; then
      echo "❌ Failed to create sonataflow database. Aborting RBAC deployment."
      return 1
    fi
    oc -n "${NAME_SPACE_RBAC}" patch sfp sonataflow-platform --type=merge \
      -p '{"spec":{"services":{"jobService":{"podTemplate":{"container":{"env":[{"name":"QUARKUS_DATASOURCE_REACTIVE_POSTGRESQL_SSL_MODE","value":"allow"},{"name":"QUARKUS_DATASOURCE_REACTIVE_TRUST_ALL","value":"true"}]}}}}}}'
    oc rollout restart deployment/sonataflow-platform-jobs-service -n "${NAME_SPACE_RBAC}"
  fi

  # initiate orchestrator workflows deployment
  if should_skip_orchestrator; then
    log::warn "Skipping orchestrator workflows deployment on PR job: ${JOB_NAME}"
  else
    deploy_orchestrator_workflows "${NAME_SPACE_RBAC}"
  fi
}

initiate_deployments() {
  cd "${DIR}"
  base_deployment
  rbac_deployment
}

# OSD-GCP specific deployment functions that merge diff files and skip orchestrator workflows
base_deployment_osd_gcp() {
  namespace::configure ${NAME_SPACE}

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}"
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  # Merge base values with OSD-GCP diff file
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase_OSD-GCP.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE}"
  cp -a "/tmp/merged-values_showcase_OSD-GCP.yaml" "${ARTIFACT_DIR}/${NAME_SPACE}/" # Save the final value-file into the artifacts directory.

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged-values_showcase_OSD-GCP.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params)

  # Skip orchestrator workflows deployment for OSD-GCP
  log::warn "Skipping orchestrator workflows deployment on OSD-GCP environment"
}

rbac_deployment_osd_gcp() {
  namespace::configure "${NAME_SPACE_POSTGRES_DB}"
  namespace::configure "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  # Initiate rbac instance deployment.
  local rbac_rhdh_base_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"

  # Merge RBAC values with OSD-GCP diff file
  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_RBAC_OSD_GCP_DIFF_VALUE_FILE_NAME}" "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml"
  mkdir -p "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}"
  cp -a "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml" "${ARTIFACT_DIR}/${NAME_SPACE_RBAC}/" # Save the final value-file into the artifacts directory.

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"

  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged-values_showcase-rbac_OSD-GCP.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params)

  # Skip orchestrator workflows deployment for OSD-GCP
  log::warn "Skipping orchestrator workflows deployment on OSD-GCP RBAC environment"
}

initiate_deployments_osd_gcp() {
  cd "${DIR}"
  base_deployment_osd_gcp
  rbac_deployment_osd_gcp
}

# install base RHDH deployment before upgrade
initiate_upgrade_base_deployments() {
  local release_name=$1
  local namespace=$2
  local url=$3

  log::info "Initiating base RHDH deployment before upgrade"

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace $CURRENT_DEPLOYMENT "$namespace"

  namespace::configure "${namespace}"

  deploy_redis_cache "${namespace}"

  cd "${DIR}" || return 1

  apply_yaml_files "${DIR}" "${namespace}" "${url}"
  log::info "Deploying image from base repository: ${QUAY_REPO_BASE}, TAG_NAME_BASE: ${TAG_NAME_BASE}, in NAME_SPACE: ${namespace}"

  # Get dynamic value file path based on previous release version
  local previous_release_value_file
  previous_release_value_file=$(helm::get_previous_release_values "showcase")
  echo "Using dynamic value file: ${previous_release_value_file}"

  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION_BASE}" \
    -f "${previous_release_value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO_BASE}" \
    --set upstream.backstage.image.tag="${TAG_NAME_BASE}"
}

initiate_upgrade_deployments() {
  local _release_name=$1 # unused, kept for interface compatibility
  local namespace=$2
  local _url=$3 # unused, kept for interface compatibility
  local wait_upgrade="10m"

  log::info "Initiating upgrade deployment"
  cd "${DIR}" || return 1

  helm::merge_values "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase_upgrade.yaml" "/tmp/merged_value_file.yaml"
  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"

  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/merged_value_file.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    --set upstream.backstage.image.repository="${QUAY_REPO}" \
    --set upstream.backstage.image.tag="${TAG_NAME}" \
    --wait --timeout=${wait_upgrade}

  oc get pods -n "${namespace}"
  save_all_pod_logs "$namespace"
}

initiate_runtime_deployment() {
  local release_name=$1
  local namespace=$2
  namespace::configure "${namespace}"
  helm::uninstall "${namespace}" "${release_name}"

  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${namespace}"

  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "$DIR/resources/postgres-db/values-showcase-postgres.yaml" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params)
}

initiate_sanity_plugin_checks_deployment() {
  local release_name=$1
  local name_space_sanity_plugins_check=$2
  local sanity_plugins_url=$3

  namespace::configure "${name_space_sanity_plugins_check}"
  helm::uninstall "${name_space_sanity_plugins_check}" "${release_name}"
  deploy_redis_cache "${name_space_sanity_plugins_check}"
  apply_yaml_files "${DIR}" "${name_space_sanity_plugins_check}" "${sanity_plugins_url}"
  helm::merge_values "overwrite" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/${HELM_CHART_SANITY_PLUGINS_DIFF_VALUE_FILE_NAME}" "/tmp/${HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME}"
  mkdir -p "${ARTIFACT_DIR}/${name_space_sanity_plugins_check}"
  cp -a "/tmp/${HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME}" "${ARTIFACT_DIR}/${name_space_sanity_plugins_check}/" || true # Save the final value-file into the artifacts directory.
  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${name_space_sanity_plugins_check}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "/tmp/${HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params) \
    --set orchestrator.enabled=true
}

# ==============================================================================
# Common Functions - Delegate to lib/common.sh
# ==============================================================================
is_openshift() {
  oc get routes.route.openshift.io &> /dev/null || kubectl get routes.route.openshift.io &> /dev/null
}

# Helper function to wait for backstage resource to exist in namespace
wait_for_backstage_resource() {
  local namespace=$1
  local max_attempts=40 # 40 attempts * 15 seconds = 10 minutes
  local sleep_interval=15

  log::info "Waiting for backstage resource to exist in namespace: $namespace"

  if ! common::poll_until \
    "[[ \$(oc get backstage -n '$namespace' -o json | jq '.items | length') -gt 0 ]]" \
    "$max_attempts" "$sleep_interval" \
    "Backstage resource found in namespace: $namespace"; then
    log::error "Error: No backstage resource found after 10 minutes"
    return 1
  fi
  return 0
}
