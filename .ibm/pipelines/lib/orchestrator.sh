#!/usr/bin/env bash

# Module: orchestrator
# Description: Orchestrator infrastructure and workflow deployment utilities
# Dependencies: oc, helm, git, yq, lib/log.sh, lib/k8s-wait.sh

# Prevent re-sourcing
if [[ -n "${ORCHESTRATOR_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly ORCHESTRATOR_LIB_SOURCED=1

# Source logging library
# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# ==============================================================================
# Constants
# ==============================================================================
readonly ORCHESTRATOR_WORKFLOW_REPO="https://github.com/rhdhorchestrator/serverless-workflows.git"
readonly ORCHESTRATOR_WORKFLOWS="greeting failswitch"
readonly ORCHESTRATOR_DEMO_REPO="https://github.com/rhdhorchestrator/orchestrator-demo.git"
readonly ORCHESTRATOR_TOKEN_PROPAGATION_IMAGE="${TOKEN_PROPAGATION_IMAGE:-quay.io/orchestrator/demo-token-propagation:latest}"

# ==============================================================================
# Orchestrator Skip Logic
# ==============================================================================

# Function: orchestrator::should_skip
# Description: Determines if orchestrator installation should be skipped
# Skip conditions:
#   1. OSD-GCP jobs: Infrastructure limitations prevent orchestrator from working
#   2. PR presubmit jobs (e2e-ocp-helm non-nightly): Speed up CI feedback loop
# Nightly jobs should always run orchestrator for full testing coverage.
# Returns:
#   0 - Should skip orchestrator
#   1 - Should NOT skip orchestrator
orchestrator::should_skip() {
  if [[ "${JOB_NAME}" =~ osd-gcp ]]; then
    return 0
  fi
  if [[ "${JOB_NAME}" =~ e2e-ocp-helm ]] && [[ "${JOB_NAME}" != *nightly* ]]; then
    return 0
  fi
  return 1
}

# Function: orchestrator::disable_plugins_in_values
# Description: Post-process merged Helm values to disable all orchestrator plugins
# Arguments:
#   $1 - values_file: Path to Helm values file
# Returns:
#   0 - Success
orchestrator::disable_plugins_in_values() {
  local values_file=$1
  yq eval -i '(.global.dynamic.plugins[] | select(.package | contains("orchestrator")) | .disabled) = true' "${values_file}"
  return 0
}

# ==============================================================================
# Private Helper Functions
# ==============================================================================

# Function: _orchestrator::clone_workflows
# Description: Clone the serverless-workflows repository
# Arguments:
#   $1 - shallow: if "true", use --depth=1 for faster clone
# Returns:
#   Sets WORKFLOW_DIR, FAILSWITCH_MANIFESTS, GREETING_MANIFESTS variables
_orchestrator::clone_workflows() {
  local shallow=${1:-false}

  WORKFLOW_DIR="${DIR}/serverless-workflows"
  FAILSWITCH_MANIFESTS="${WORKFLOW_DIR}/workflows/fail-switch/src/main/resources/manifests/"
  GREETING_MANIFESTS="${WORKFLOW_DIR}/workflows/greeting/manifests/"

  rm -rf "${WORKFLOW_DIR}"
  if [[ "$shallow" == "true" ]]; then
    git clone --depth=1 "${ORCHESTRATOR_WORKFLOW_REPO}" "${WORKFLOW_DIR}" || {
      log::error "Failed to clone serverless-workflows"
      return 1
    }
  else
    git clone "${ORCHESTRATOR_WORKFLOW_REPO}" "${WORKFLOW_DIR}" || {
      log::error "Failed to clone serverless-workflows"
      return 1
    }
  fi
  return 0
}

# Function: _orchestrator::clone_demo_workflows
# Description: Clone the orchestrator-demo repository
# Arguments:
#   $1 - shallow: if "true", use --depth=1 for faster clone (default: true)
# Returns:
#   Sets DEMO_WORKFLOW_DIR, TOKEN_PROPAGATION_MANIFESTS variables
_orchestrator::clone_demo_workflows() {
  local shallow=${1:-true}

  DEMO_WORKFLOW_DIR="${DIR}/orchestrator-demo"
  TOKEN_PROPAGATION_MANIFESTS="${DEMO_WORKFLOW_DIR}/09_token_propagation/manifests"

  rm -rf "${DEMO_WORKFLOW_DIR}"
  if [[ "$shallow" == "true" ]]; then
    git clone --depth=1 "${ORCHESTRATOR_DEMO_REPO}" "${DEMO_WORKFLOW_DIR}" || {
      log::error "Failed to clone orchestrator-demo"
      return 1
    }
  else
    git clone "${ORCHESTRATOR_DEMO_REPO}" "${DEMO_WORKFLOW_DIR}" || {
      log::error "Failed to clone orchestrator-demo"
      return 1
    }
  fi
  return 0
}

# Function: _orchestrator::prepare_token_propagation_manifests
# Description: Substitute placeholder values in cloned token-propagation manifests
# Arguments:
#   $1 - namespace: Kubernetes namespace
#   $2 - kc_auth_server_url: Keycloak auth server URL
#   $3 - kc_client_id: Keycloak client ID
#   $4 - kc_client_secret: Keycloak client secret
#   $5 - kc_token_url: Keycloak token URL
_orchestrator::prepare_token_propagation_manifests() {
  local namespace=$1
  local kc_auth_server_url=$2
  local kc_client_id=$3
  local kc_client_secret=$4
  local kc_token_url=$5

  local props_cm="${TOKEN_PROPAGATION_MANIFESTS}/01-configmap_token-propagation-props.yaml"
  local specs_cm="${TOKEN_PROPAGATION_MANIFESTS}/03-configmap_02-token-propagation-resources-specs.yaml"
  local sf_cr="${TOKEN_PROPAGATION_MANIFESTS}/04-sonataflow_token-propagation.yaml"

  local sample_server_url="http://sample-server-service.${namespace}:8080"

  # Props ConfigMap: substitute Keycloak and sample-server placeholders
  # Uses yq to read/write YAML safely + sed for string substitution (avoids yq gsub which requires v4.30+)
  export MODIFIED_PROPS
  MODIFIED_PROPS=$(yq eval '.data."application.properties"' "${props_cm}" | sed \
    -e "s|http://example-kc-service.keycloak:8080/realms/quarkus|${kc_auth_server_url}|g" \
    -e "s|client-id=quarkus-app|client-id=${kc_client_id}|g" \
    -e "s|client-secret=lVGSvdaoDUem7lqeAnqXn1F92dCPbQea|client-secret=${kc_client_secret}|g" \
    -e "s|http://sample-server-service.rhdh-operator|${sample_server_url}|g")

  # Ensure quarkus.tls.trust-all=true is present (defensive)
  if ! echo "${MODIFIED_PROPS}" | grep -q 'quarkus.tls.trust-all=true'; then
    MODIFIED_PROPS=$(echo "${MODIFIED_PROPS}" | sed 's|kie.flyway.enabled=true|kie.flyway.enabled=true\n    quarkus.tls.trust-all=true|')
  fi

  yq eval -i '.data."application.properties" = strenv(MODIFIED_PROPS)' "${props_cm}"
  unset MODIFIED_PROPS

  # Specs ConfigMap: substitute Keycloak token URL
  export MODIFIED_SPECS
  MODIFIED_SPECS=$(yq eval '.data."sample-server.yaml"' "${specs_cm}" | sed \
    -e "s|http://example-kc-service.keycloak:8080/realms/quarkus/protocol/openid-connect/token|${kc_token_url}|g")
  yq eval -i '.data."sample-server.yaml" = strenv(MODIFIED_SPECS)' "${specs_cm}"
  unset MODIFIED_SPECS

  # SonataFlow CR: set image, strip persistence and status
  yq eval -i '.spec.podTemplate.container.image = "'"${ORCHESTRATOR_TOKEN_PROPAGATION_IMAGE}"'"' "${sf_cr}"
  yq eval -i 'del(.spec.persistence)' "${sf_cr}"
  yq eval -i 'del(.status)' "${sf_cr}"

  return 0
}

# Function: _orchestrator::apply_manifests
# Description: Apply workflow manifests to the namespace
# Arguments:
#   $1 - namespace: Kubernetes namespace
_orchestrator::apply_manifests() {
  local namespace=$1

  oc apply -f "${FAILSWITCH_MANIFESTS}" -n "$namespace"
  oc apply -f "${GREETING_MANIFESTS}" -n "$namespace"
  return 0
}

# Function: _orchestrator::wait_for_sonataflow_resources
# Description: Wait for sonataflow resources to be created
# Arguments:
#   $1 - namespace: Kubernetes namespace
#   $2 - timeout: optional timeout in seconds (default: 30)
_orchestrator::wait_for_sonataflow_resources() {
  local namespace=$1
  local timeout_secs=${2:-30}

  timeout "${timeout_secs}s" bash -c "
    until [[ \$(oc get sf -n $namespace --no-headers 2>/dev/null | wc -l) -eq 2 ]]; do
      echo 'Waiting for 2 sonataflow resources...'
      sleep 5
    done
  " || log::warn "Timeout waiting for sonataflow resources, continuing..."
  return 0
}

# Function: _orchestrator::wait_for_sonataflow_reconciliation
# Description: Wait for SonataFlow operator to reconcile after CR patch
# Arguments:
#   $1 - namespace: Kubernetes namespace
#   $2 - workflow: Workflow name
#   $3 - timeout_secs: Timeout in seconds (default: 60)
# Returns:
#   0 - Success (operator reconciled)
#   1 - Timeout waiting for reconciliation
_orchestrator::wait_for_sonataflow_reconciliation() {
  local namespace=$1
  local workflow=$2
  local timeout_secs=${3:-60}

  log::info "Waiting for SonataFlow operator to reconcile $workflow..."

  local start_time
  start_time=$(date +%s)

  while true; do
    local current_time
    current_time=$(date +%s)
    local elapsed=$((current_time - start_time))

    if [[ $elapsed -ge $timeout_secs ]]; then
      log::warn "Timeout waiting for operator reconciliation after ${timeout_secs}s"
      return 1
    fi

    # Check if deployment exists and has available replicas or is progressing
    local ready
    ready=$(oc get deployment "$workflow" -n "$namespace" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].status}' 2> /dev/null || echo "")

    if [[ "$ready" == "True" ]]; then
      log::info "SonataFlow operator reconciled $workflow deployment"
      return 0
    fi

    sleep 2
  done
}

# Function: _orchestrator::patch_workflow_postgres
# Description: Patch a single workflow with PostgreSQL configuration
# Arguments:
#   $1 - namespace: Kubernetes namespace
#   $2 - workflow: Workflow name
#   $3 - secret_name: PostgreSQL secret name
#   $4 - user_key: Key for username in secret
#   $5 - password_key: Key for password in secret
#   $6 - svc_name: PostgreSQL service name
#   $7 - svc_namespace: PostgreSQL service namespace
#   $8 - database_name: Database name (optional)
#   $9 - database_schema: Database schema (optional)
_orchestrator::patch_workflow_postgres() {
  local namespace=$1
  local workflow=$2
  local secret_name=$3
  local user_key=$4
  local password_key=$5
  local svc_name=$6
  local svc_namespace=$7
  local database_name=${8:-}
  local database_schema=${9:-}

  local service_ref="{\"name\": \"$svc_name\", \"namespace\": \"$svc_namespace\""
  if [[ -n "$database_name" ]]; then
    service_ref+=", \"databaseName\": \"$database_name\""
  fi
  if [[ -n "$database_schema" ]]; then
    service_ref+=", \"databaseSchema\": \"$database_schema\""
  fi
  service_ref+="}"

  local patch_json="{\"spec\": {\"persistence\": {\"postgresql\": {\"secretRef\": {\"name\": \"$secret_name\", \"userKey\": \"$user_key\", \"passwordKey\": \"$password_key\"}, \"serviceRef\": $service_ref}}}}"

  oc -n "$namespace" patch sonataflow "$workflow" --type merge -p "$patch_json"

  # Wait for operator to reconcile before checking rollout status
  _orchestrator::wait_for_sonataflow_reconciliation "$namespace" "$workflow" 60

  oc rollout status deployment/"$workflow" -n "$namespace" --timeout=600s
  return 0
}

# Function: _orchestrator::wait_for_workflow_deployments
# Description: Wait for all workflow deployments to be ready
# Arguments:
#   $1 - namespace: Kubernetes namespace
_orchestrator::wait_for_workflow_deployments() {
  local namespace=$1

  log::info "Waiting for all workflow pods to be running..."
  for workflow in $ORCHESTRATOR_WORKFLOWS; do
    k8s_wait::deployment "$namespace" "$workflow" 5
  done
  log::success "All workflow pods are now running!"
  return 0
}

# Function: _orchestrator::deploy_sample_server
# Description: Deploy the sample-server echo server for token propagation testing
# Arguments:
#   $1 - namespace: Kubernetes namespace
_orchestrator::deploy_sample_server() {
  local namespace=$1

  log::info "Deploying sample-server..."

  oc apply -n "$namespace" -f - << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sample-server
  labels:
    app: sample-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sample-server
  template:
    metadata:
      labels:
        app: sample-server
    spec:
      containers:
        - name: sample-server
          image: quay.io/orchestrator/sample-server:latest
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: sample-server-service
  labels:
    app: sample-server
spec:
  selector:
    app: sample-server
  ports:
    - port: 8080
      targetPort: 8080
      protocol: TCP
EOF

  log::info "Waiting for sample-server to become available..."
  if ! oc wait deployment/sample-server -n "$namespace" --for=condition=Available --timeout=120s; then
    log::error "sample-server deployment did not become available within 120s"
    return 1
  fi
  log::info "sample-server is running"
  return 0
}

# Function: _orchestrator::deploy_token_propagation
# Description: Deploy the token-propagation workflow by cloning manifests from
#   orchestrator-demo, substituting placeholders, applying, and patching persistence.
# Arguments:
#   $1 - namespace: Kubernetes namespace
#   $2 - psql_secret_name: PostgreSQL secret name
#   $3 - psql_user_key: Key for username in secret
#   $4 - psql_password_key: Key for password in secret
#   $5 - psql_svc_name: PostgreSQL service name
#   $6 - psql_svc_namespace: PostgreSQL service namespace
#   $7 - psql_db_name: Database name (optional)
_orchestrator::deploy_token_propagation() {
  local namespace=$1
  local psql_secret_name=$2
  local psql_user_key=$3
  local psql_password_key=$4
  local psql_svc_name=$5
  local psql_svc_namespace=$6
  local psql_db_name=${7:-}

  log::info "Deploying token-propagation workflow..."

  # Decode base64-encoded Keycloak env vars
  local kc_base_url kc_realm kc_client_id kc_client_secret
  kc_base_url=$(printf '%s' "${KEYCLOAK_AUTH_BASE_URL}" | base64 -d)
  kc_realm=$(printf '%s' "${KEYCLOAK_AUTH_REALM}" | base64 -d)
  kc_client_id=$(printf '%s' "${KEYCLOAK_AUTH_CLIENTID}" | base64 -d)
  kc_client_secret=$(printf '%s' "${KEYCLOAK_AUTH_CLIENT_SECRET}" | base64 -d)

  if [[ -z "$kc_base_url" || -z "$kc_realm" || -z "$kc_client_id" || -z "$kc_client_secret" ]]; then
    log::error "Failed to decode Keycloak credentials -- check that KEYCLOAK_AUTH_* env vars are set and base64-encoded"
    return 1
  fi

  local kc_auth_server_url="${kc_base_url}/auth/realms/${kc_realm}"
  local kc_token_url="${kc_auth_server_url}/protocol/openid-connect/token"

  log::info "Keycloak auth-server-url: ${kc_auth_server_url}"

  # Clone orchestrator-demo repo
  _orchestrator::clone_demo_workflows

  # Substitute manifest placeholders
  _orchestrator::prepare_token_propagation_manifests \
    "$namespace" "$kc_auth_server_url" "$kc_client_id" "$kc_client_secret" "$kc_token_url"

  # Deploy sample-server echo service
  _orchestrator::deploy_sample_server "$namespace" || return 1

  # Apply modified manifests
  oc apply -n "$namespace" -f "${TOKEN_PROPAGATION_MANIFESTS}"

  # Patch persistence (reuse existing function)
  _orchestrator::patch_workflow_postgres "$namespace" "token-propagation" \
    "$psql_secret_name" "$psql_user_key" "$psql_password_key" \
    "$psql_svc_name" "$psql_svc_namespace" "$psql_db_name" "token-propagation"

  # Clean up cloned repo
  rm -rf "${DEMO_WORKFLOW_DIR}"

  return 0
}

# ==============================================================================
# Orchestrator Infrastructure Installation
# ==============================================================================

# Function: orchestrator::install_infra_chart
# Description: Deploys the orchestrator-infra Helm chart
# Returns:
#   0 - Success
#   1 - Failure
orchestrator::install_infra_chart() {
  local orch_infra_ns="orchestrator-infra"
  namespace::configure "${orch_infra_ns}"

  log::info "Deploying orchestrator-infra chart"
  helm upgrade -i orch-infra -n "${orch_infra_ns}" \
    "oci://quay.io/rhdh/orchestrator-infra-chart" --version "${CHART_VERSION}" \
    --wait --timeout=5m \
    --set serverlessLogicOperator.subscription.spec.installPlanApproval=Automatic \
    --set serverlessOperator.subscription.spec.installPlanApproval=Automatic

  until [[ "$(oc get pods -n openshift-serverless --no-headers 2> /dev/null | wc -l)" -gt 0 ]]; do
    sleep 5
  done

  until [[ "$(oc get pods -n openshift-serverless-logic --no-headers 2> /dev/null | wc -l)" -gt 0 ]]; do
    sleep 5
  done

  log::info "orchestrator-infra chart deployed - openshift-serverless and openshift-serverless-logic pods found"
  return 0
}

# ==============================================================================
# Workflow Deployment Functions
# ==============================================================================

# Function: orchestrator::deploy_workflows
# Description: Deploy workflows for Helm-based orchestrator testing
# Arguments:
#   $1 - namespace: Kubernetes namespace for deployment
# Returns:
#   0 - Success
#   1 - Failure
orchestrator::deploy_workflows() {
  local namespace=$1

  # Clone workflows repository
  _orchestrator::clone_workflows "false"

  # Determine PostgreSQL configuration based on namespace
  local pqsl_secret_name pqsl_user_key pqsl_password_key pqsl_svc_name patch_namespace
  if [[ "$namespace" == "${NAME_SPACE_RBAC}" ]]; then
    pqsl_secret_name="postgres-cred"
    pqsl_user_key="POSTGRES_USER"
    pqsl_password_key="POSTGRES_PASSWORD"
    pqsl_svc_name="postgress-external-db-primary"
    patch_namespace="${NAME_SPACE_POSTGRES_DB}"
  else
    pqsl_secret_name="rhdh-postgresql-svcbind-postgres"
    pqsl_user_key="username"
    pqsl_password_key="password"
    pqsl_svc_name="rhdh-postgresql"
    patch_namespace="$namespace"
  fi

  # Apply manifests and wait for resources
  _orchestrator::apply_manifests "$namespace"
  _orchestrator::wait_for_sonataflow_resources "$namespace"

  # Patch each workflow with PostgreSQL configuration
  for workflow in $ORCHESTRATOR_WORKFLOWS; do
    _orchestrator::patch_workflow_postgres "$namespace" "$workflow" \
      "$pqsl_secret_name" "$pqsl_user_key" "$pqsl_password_key" \
      "$pqsl_svc_name" "$patch_namespace"
  done

  _orchestrator::wait_for_workflow_deployments "$namespace"

  # Deploy token-propagation workflow in non-RBAC namespace only
  if [[ "$namespace" != "${NAME_SPACE_RBAC}" ]]; then
    _orchestrator::deploy_token_propagation "$namespace" \
      "$pqsl_secret_name" "$pqsl_user_key" "$pqsl_password_key" \
      "$pqsl_svc_name" "$patch_namespace" || return 1
  fi

  return 0
}

# Function: orchestrator::deploy_workflows_operator
# Description: Deploy workflows for Operator-based orchestrator testing
# Arguments:
#   $1 - namespace: Kubernetes namespace for deployment
# Returns:
#   0 - Success
#   1 - Failure
orchestrator::deploy_workflows_operator() {
  local namespace=$1

  # Clone workflows repository (shallow for speed)
  _orchestrator::clone_workflows "true"

  # Wait for backstage and sonataflow pods to be ready
  k8s_wait::deployment "$namespace" backstage-psql 15
  k8s_wait::deployment "$namespace" backstage-rhdh 15
  k8s_wait::deployment "$namespace" sonataflow-platform-data-index-service 20
  k8s_wait::deployment "$namespace" sonataflow-platform-jobs-service 20

  # Dynamic PostgreSQL configuration discovery
  local pqsl_secret_name pqsl_svc_name
  pqsl_secret_name=$(oc get secrets -n "$namespace" -o name | grep "backstage-psql" | grep "secret" | head -1 | sed 's/secret\///')
  pqsl_svc_name=$(oc get svc -n "$namespace" -o name | grep "backstage-psql" | grep -v "secret" | head -1 | sed 's/service\///')

  # Validate discovered resources
  if [[ -z "$pqsl_secret_name" ]]; then
    log::error "No PostgreSQL secret found matching pattern 'backstage-psql.*secret' in namespace '$namespace'"
    return 1
  fi

  if [[ -z "$pqsl_svc_name" ]]; then
    log::error "No PostgreSQL service found matching pattern 'backstage-psql' in namespace '$namespace'"
    return 1
  fi

  log::info "Found PostgreSQL secret: $pqsl_secret_name"
  log::info "Found PostgreSQL service: $pqsl_svc_name"

  # Apply manifests and wait for resources
  _orchestrator::apply_manifests "$namespace"
  _orchestrator::wait_for_sonataflow_resources "$namespace"

  # Patch each workflow with PostgreSQL configuration (including database name)
  local sonataflow_db="backstage_plugin_orchestrator"
  for workflow in $ORCHESTRATOR_WORKFLOWS; do
    _orchestrator::patch_workflow_postgres "$namespace" "$workflow" \
      "$pqsl_secret_name" "POSTGRES_USER" "POSTGRES_PASSWORD" \
      "$pqsl_svc_name" "$namespace" "$sonataflow_db"
  done

  _orchestrator::wait_for_workflow_deployments "$namespace"
  return 0
}

# ==============================================================================
# Operator Plugin Enablement
# ==============================================================================

# Function: orchestrator::enable_plugins_operator
# Description: Enable orchestrator plugins for operator deployment
#   Merges the operator-provided default dynamic plugins configmap
#   (backstage-dynamic-plugins-*) with custom dynamic-plugins configmap.
#   The merge ensures custom plugins override defaults when packages conflict.
#   After merging, the deployment is restarted to pick up the updated plugins.
# Arguments:
#   $1 - namespace: Kubernetes namespace
# Returns:
#   0 - Success
#   1 - Failure
orchestrator::enable_plugins_operator() {
  local namespace=$1

  # Validate required parameter
  if [[ -z "$namespace" ]]; then
    log::error "Missing required namespace parameter"
    log::error "Usage: orchestrator::enable_plugins_operator <namespace>"
    return 1
  fi

  log::info "Enabling orchestrator plugins in namespace: $namespace"

  # Find the dynamic plugins configmap created by the operator
  local operator_cm
  operator_cm=$(oc get cm -n "$namespace" -o name 2> /dev/null | grep "backstage-dynamic-plugins-" | head -1 | sed 's/configmap\///')

  if [[ -z "$operator_cm" ]]; then
    log::error "No operator dynamic plugins configmap found (backstage-dynamic-plugins-*) in namespace: $namespace"
    return 1
  fi
  log::info "Found operator configmap: $operator_cm"

  # Extract the YAML content from both configmaps
  local operator_yaml custom_yaml
  operator_yaml=$(oc get cm "$operator_cm" -n "$namespace" -o jsonpath='{.data.dynamic-plugins\.yaml}')
  custom_yaml=$(oc get cm "dynamic-plugins" -n "$namespace" -o jsonpath='{.data.dynamic-plugins\.yaml}' 2> /dev/null || echo "")

  if [[ -z "$custom_yaml" ]]; then
    log::warn "No custom dynamic-plugins configmap found, using operator defaults only"
    return 0
  fi

  # Merge the plugins arrays: custom plugins override operator defaults
  # Uses package name as the unique key for deduplication
  local merged_yaml
  merged_yaml=$(
    echo "$operator_yaml" "$custom_yaml" | yq eval-all '
    {"plugins": [
      ([.[].plugins[]] | group_by(.package) | .[] | last)
    ]}
  '
  )

  # Patch the operator configmap with merged content
  oc patch cm "$operator_cm" -n "$namespace" --type merge -p "{\"data\":{\"dynamic-plugins.yaml\":$(echo "$merged_yaml" | jq -Rs .)}}"

  log::info "Merged dynamic plugins configmap updated"

  # Find and restart the backstage deployment
  local backstage_deployment
  backstage_deployment=$(oc get deployment -n "$namespace" -o name 2> /dev/null | grep "backstage" | grep -v "psql" | head -1)

  if [[ -n "$backstage_deployment" ]]; then
    log::info "Restarting $backstage_deployment to pick up plugin changes..."
    oc rollout restart "$backstage_deployment" -n "$namespace"
    oc rollout status "$backstage_deployment" -n "$namespace" --timeout=300s
  fi

  log::success "Orchestrator plugins enabled successfully"
  return 0
}
