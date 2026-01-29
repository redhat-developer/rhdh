#!/usr/bin/env bash

# Module: orchestrator
# Description: Orchestrator infrastructure and workflow deployment utilities
# Dependencies: oc, helm, git, yq

# shellcheck source=./log.sh
source "$(dirname "${BASH_SOURCE[0]}")/log.sh"

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
  [[ "${JOB_NAME}" =~ osd-gcp ]] || { [[ "${JOB_NAME}" =~ e2e-ocp-helm ]] && [[ "${JOB_NAME}" != *nightly* ]]; }
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
  configure_namespace "${orch_infra_ns}"

  log::info "Deploying orchestrator-infra chart"
  helm upgrade -i orch-infra -n "${orch_infra_ns}" \
    "oci://quay.io/rhdh/orchestrator-infra-chart" --version "${CHART_VERSION}" \
    --wait --timeout=5m \
    --set serverlessLogicOperator.subscription.spec.installPlanApproval=Automatic \
    --set serverlessOperator.subscription.spec.installPlanApproval=Automatic

  until [ "$(oc get pods -n openshift-serverless --no-headers 2> /dev/null | wc -l)" -gt 0 ]; do
    sleep 5
  done

  until [ "$(oc get pods -n openshift-serverless-logic --no-headers 2> /dev/null | wc -l)" -gt 0 ]; do
    sleep 5
  done

  log::info "orchestrator-infra chart deployed - openshift-serverless and openshift-serverless-logic pods found"
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

  local WORKFLOW_REPO="https://github.com/rhdhorchestrator/serverless-workflows.git"
  local WORKFLOW_DIR="${DIR}/serverless-workflows"
  local FAILSWITCH_MANIFESTS="${WORKFLOW_DIR}/workflows/fail-switch/src/main/resources/manifests/"
  local GREETING_MANIFESTS="${WORKFLOW_DIR}/workflows/greeting/manifests/"

  rm -rf "${WORKFLOW_DIR}"
  git clone "${WORKFLOW_REPO}" "${WORKFLOW_DIR}"

  if [[ "$namespace" == "${NAME_SPACE_RBAC}" ]]; then
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
    local patch_namespace="$namespace"
  fi

  oc apply -f "${FAILSWITCH_MANIFESTS}" -n "$namespace"
  oc apply -f "${GREETING_MANIFESTS}" -n "$namespace"

  until [[ $(oc get sf -n "$namespace" --no-headers 2> /dev/null | wc -l) -eq 2 ]]; do
    echo "No sf resources found. Retrying in 5 seconds..."
    sleep 5
  done

  for workflow in greeting failswitch; do
    oc -n "$namespace" patch sonataflow "$workflow" --type merge -p "{\"spec\": { \"persistence\": { \"postgresql\": { \"secretRef\": {\"name\": \"$pqsl_secret_name\",\"userKey\": \"$pqsl_user_key\",\"passwordKey\": \"$pqsl_password_key\"},\"serviceRef\": {\"name\": \"$pqsl_svc_name\",\"namespace\": \"$patch_namespace\"}}}}}"
    oc rollout status deployment/"$workflow" -n "$namespace" --timeout=600s
  done

  echo "Waiting for all workflow pods to be running..."
  k8s_wait::deployment "$namespace" greeting 5
  k8s_wait::deployment "$namespace" failswitch 5

  echo "All workflow pods are now running!"
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

  local WORKFLOW_REPO="https://github.com/rhdhorchestrator/serverless-workflows.git"
  local WORKFLOW_DIR="${DIR}/serverless-workflows"
  local FAILSWITCH_MANIFESTS="${WORKFLOW_DIR}/workflows/fail-switch/src/main/resources/manifests/"
  local GREETING_MANIFESTS="${WORKFLOW_DIR}/workflows/greeting/manifests/"

  rm -rf "${WORKFLOW_DIR}"
  git clone --depth=1 "${WORKFLOW_REPO}" "${WORKFLOW_DIR}"

  # Wait for backstage and sonata flow pods to be ready before continuing
  k8s_wait::deployment "$namespace" backstage-psql 15
  k8s_wait::deployment "$namespace" backstage-rhdh 15
  # SonataFlowPlatform v1alpha08 deploys the Data Index as `sonataflow-platform-data-index-service`
  k8s_wait::deployment "$namespace" sonataflow-platform-data-index-service 20
  k8s_wait::deployment "$namespace" sonataflow-platform-jobs-service 20

  # Dynamic PostgreSQL configuration detection
  # Dynamic discovery of PostgreSQL secret and service using patterns
  local pqsl_secret_name
  pqsl_secret_name=$(oc get secrets -n "$namespace" -o name | grep "backstage-psql" | grep "secret" | head -1 | sed 's/secret\///')
  local pqsl_user_key="POSTGRES_USER"
  local pqsl_password_key="POSTGRES_PASSWORD"
  local pqsl_svc_name
  pqsl_svc_name=$(oc get svc -n "$namespace" -o name | grep "backstage-psql" | grep -v "secret" | head -1 | sed 's/service\///')
  local patch_namespace="$namespace"
  local sonataflow_db="backstage_plugin_orchestrator"

  # Validate that we found the required resources
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

  # Apply workflow manifests
  oc apply -f "${FAILSWITCH_MANIFESTS}" -n "$namespace"
  oc apply -f "${GREETING_MANIFESTS}" -n "$namespace"

  # Wait for sonataflow resources to be created (regardless of state)
  timeout 30s bash -c "
  until [[ \$(oc get sf -n $namespace --no-headers 2>/dev/null | wc -l) -eq 2 ]]; do
    echo \"Waiting for 2 sf resources... Current count: \$(oc get sf -n $namespace --no-headers 2>/dev/null | wc -l)\"
    sleep 5
  done
  "

  for workflow in greeting failswitch; do
    # Create PostgreSQL patch configuration
    local postgres_patch
    postgres_patch=$(
      cat << EOF
{
  "spec": {
    "persistence": {
      "postgresql": {
        "secretRef": {
          "name": "$pqsl_secret_name",
          "userKey": "$pqsl_user_key",
          "passwordKey": "$pqsl_password_key"
        },
        "serviceRef": {
          "name": "$pqsl_svc_name",
          "namespace": "$patch_namespace",
          "databaseName": "$sonataflow_db"
        }
      }
    }
  }
}
EOF
    )
    oc -n "$namespace" patch sonataflow "$workflow" --type merge -p "$postgres_patch"
    oc rollout status deployment/"$workflow" -n "$namespace" --timeout=600s
  done

  echo "Waiting for all workflow pods to be running..."
  k8s_wait::deployment "$namespace" greeting 5
  k8s_wait::deployment "$namespace" failswitch 5

  echo "All workflow pods are now running!"
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
}
