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
    git clone --depth=1 "${ORCHESTRATOR_WORKFLOW_REPO}" "${WORKFLOW_DIR}"
  else
    git clone "${ORCHESTRATOR_WORKFLOW_REPO}" "${WORKFLOW_DIR}"
  fi
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
_orchestrator::patch_workflow_postgres() {
  local namespace=$1
  local workflow=$2
  local secret_name=$3
  local user_key=$4
  local password_key=$5
  local svc_name=$6
  local svc_namespace=$7
  local database_name=${8:-}

  local patch_json
  if [[ -n "$database_name" ]]; then
    patch_json=$(
      cat << EOF
{
  "spec": {
    "persistence": {
      "postgresql": {
        "secretRef": {
          "name": "$secret_name",
          "userKey": "$user_key",
          "passwordKey": "$password_key"
        },
        "serviceRef": {
          "name": "$svc_name",
          "namespace": "$svc_namespace",
          "databaseName": "$database_name"
        }
      }
    }
  }
}
EOF
    )
  else
    patch_json="{\"spec\": { \"persistence\": { \"postgresql\": { \"secretRef\": {\"name\": \"$secret_name\",\"userKey\": \"$user_key\",\"passwordKey\": \"$password_key\"},\"serviceRef\": {\"name\": \"$svc_name\",\"namespace\": \"$svc_namespace\"}}}}}"
  fi

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
