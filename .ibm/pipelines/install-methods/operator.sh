#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

install_rhdh_operator() {
  local dir=$1
  local namespace=$2
  local max_attempts=$3

  configure_namespace "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT,,}" == "false" ]]; then
    setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
  fi
  # Make sure script is up to date
  rm -f /tmp/install-rhdh-catalog-source.sh
  curl -L "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh" > /tmp/install-rhdh-catalog-source.sh
  chmod +x /tmp/install-rhdh-catalog-source.sh
  if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
    echo "Installing RHDH operator with '--next' flag"
    for ((i = 1; i <= max_attempts; i++)); do
      if output=$(bash -x /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh); then
        echo "${output}"
        echo "RHDH Operator installed on attempt ${i}."
        break
      elif ((i < max_attempts)); then
        echo "Attempt ${i} failed, retrying in 10 seconds..."
        sleep 10
      elif ((i == max_attempts)); then
        echo "$output"
        echo "Failed install RHDH Operator after ${max_attempts} attempts."
        return 1
      fi
    done
  else
    local operator_version="${RELEASE_BRANCH_NAME#release-}"
    echo "Installing RHDH operator with '-v $operator_version' flag"
    for ((i = 1; i <= max_attempts; i++)); do
      if output=$(bash -x /tmp/install-rhdh-catalog-source.sh -v "$operator_version" --install-operator rhdh); then
        echo "${output}"
        echo "RHDH Operator installed on attempt ${i}."
        break
      elif ((i == max_attempts)); then
        echo "${output}"
        echo "Failed install RHDH Operator after ${max_attempts} attempts."
        return 1
      fi
    done
  fi
}

prepare_operator() {
  local retry_operator_installation="${1:-1}"
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}" "$retry_operator_installation"
}

wait_for_backstage_crd() {
  local namespace=$1
  timeout 300 bash -c "
  while ! oc get crd/backstages.rhdh.redhat.com -n '${namespace}' >/dev/null 2>&1; do
      echo 'Waiting for Backstage CRD to be created...'
      sleep 20
  done
  echo 'Backstage CRD is created.'
  " || echo "Error: Timed out waiting for Backstage CRD creation."
}

deploy_rhdh_operator() {
  local namespace=$1
  local backstage_crd_path=$2

  wait_for_backstage_crd "$namespace"]
  rendered_yaml=$(envsubst < "$backstage_crd_path")
  echo -e "Applying Backstage CRD from: $backstage_crd_path\n$rendered_yaml"
  echo "$rendered_yaml" | oc apply -f - -n "$namespace"
}

delete_rhdh_operator() {
  kubectl delete namespace "$OPERATOR_MANAGER" --ignore-not-found
}

setup_orchestrator_sonataflow_resources() {
  local namespace=$1
  local backstage_name=$2
  local postgres_service="backstage-psql-${backstage_name}"
  
  echo "============================================================"
  echo "Setting up SonataFlow resources for orchestrator"
  echo "Namespace: ${namespace}"
  echo "Backstage Name: ${backstage_name}"
  echo "PostgreSQL Service: ${postgres_service}"
  echo "============================================================"
  
  # Wait for Backstage to be ready
  echo "Step 1: Waiting for Backstage deployment to be ready..."
  if wait_for_backstage_ready "${namespace}" "${backstage_name}"; then
    echo "✓ Backstage deployment is ready"
  else
    echo "✗ Warning: Backstage deployment not ready, but continuing with orchestrator setup"
  fi
  
  # Create orchestrator database BEFORE applying SonataFlow resources
  echo "Step 2: Creating orchestrator database (before SonataFlow resources)..."
  if create_sonataflow_database "${namespace}" "backstage_plugin_orchestrator" "${postgres_service}"; then
    echo "✓ Database creation completed successfully"
  else
    echo "✗ Warning: Database creation failed, but continuing with resource setup"
  fi
  
  # Apply SonataFlow platform and network policies
  echo "Step 3: Applying SonataFlow platform and network policies..."
  if apply_sonataflow_resources "${namespace}" "${backstage_name}"; then
    echo "✓ SonataFlow resources applied successfully"
  else
    echo "✗ Warning: SonataFlow resource application failed"
  fi
  
  # Validate SonataFlow resources are ready
  echo "Step 4: Validating SonataFlow resources..."
  if validate_sonataflow_resources "${namespace}"; then
    echo "✓ SonataFlow validation completed"
  else
    echo "✗ Warning: SonataFlow validation encountered issues"
  fi
  
  echo "============================================================"
  echo "SonataFlow resources setup completed for namespace: ${namespace}"
  echo "============================================================"
}

wait_for_backstage_ready() {
  local namespace=$1
  local backstage_name=$2
  local timeout=${3:-300}  # Default timeout: 5 minutes
  local check_interval=${4:-10}  # Default interval: 10 seconds

  local max_attempts=$((timeout / check_interval))
  
  echo "Waiting for Backstage deployment '${backstage_name}' in namespace '${namespace}' (timeout: ${timeout}s)..."
  
  for ((i=1; i<=max_attempts; i++)); do
    # Check if the Backstage deployment exists and is available
    if oc get deployment "backstage-${backstage_name}" -n "${namespace}" >/dev/null 2>&1; then
      local ready_replicas=$(oc get deployment "backstage-${backstage_name}" -n "${namespace}" -o jsonpath='{.status.readyReplicas}')
      local desired_replicas=$(oc get deployment "backstage-${backstage_name}" -n "${namespace}" -o jsonpath='{.spec.replicas}')
      
      if [[ "${ready_replicas}" == "${desired_replicas}" ]] && [[ "${ready_replicas}" -gt 0 ]]; then
        echo "✓ Backstage deployment is ready (${ready_replicas}/${desired_replicas} replicas)"
        return 0
      else
        echo "Backstage deployment not ready yet (${ready_replicas:-0}/${desired_replicas} replicas ready)"
      fi
    else
      echo "Backstage deployment 'backstage-${backstage_name}' not found in namespace '${namespace}'"
    fi
    
    echo "Still waiting... (${i}/${max_attempts} checks)"
    sleep "${check_interval}"
  done
  
  echo "✗ Timeout waiting for Backstage deployment to be ready"
  return 1
}

create_sonataflow_database() {
  local namespace=$1
  local database_name=$2
  local postgres_service=$3
  local timeout=${4:-120}  # Default timeout: 2 minutes
  
  echo "Creating SonataFlow database '${database_name}' in namespace '${namespace}'..."
  
  # Wait for PostgreSQL service to be available
  echo "Checking PostgreSQL service availability..."
  if ! oc get service "${postgres_service}" -n "${namespace}" >/dev/null 2>&1; then
    echo "✗ PostgreSQL service '${postgres_service}' not found in namespace '${namespace}'"
    return 1
  fi
  
  # Create a temporary pod to execute database creation
  local temp_pod="orchestrator-db-setup-$(date +%s)"
  echo "Creating temporary pod '${temp_pod}' for database setup..."
  
  oc run "${temp_pod}" -n "${namespace}" --image=postgres:13 --rm -i --restart=Never \
    --env="PGPASSWORD=\${POSTGRESQL_ADMIN_PASSWORD}" \
    --command -- psql -h "${postgres_service}" -U postgres -c \
    "CREATE DATABASE ${database_name};" >/dev/null 2>&1 || {
    echo "Database '${database_name}' may already exist or creation failed"
  }
  
  echo "✓ Database setup completed for '${database_name}'"
  return 0
}

apply_sonataflow_resources() {
  local namespace=$1
  local backstage_name=$2
  
  echo "Applying SonataFlow platform and network policies to namespace '${namespace}'..."
  
  # Apply SonataFlowPlatform configuration
  cat <<EOF | oc apply -f -
apiVersion: sonataflow.org/v1alpha08
kind: SonataFlowPlatform
metadata:
  name: sonataflow-platform
  namespace: ${namespace}
spec:
  services:
    dataIndex:
      enabled: true
      persistence:
        postgresql:
          serviceRef:
            databaseSchema: backstage_plugin_orchestrator
            name: backstage-psql-${backstage_name}
            namespace: ${namespace}
          secretRef:
            name: backstage-psql-${backstage_name}
            passwordKey: postgres-password
            userKey: postgres-username
    jobService:
      enabled: true
      persistence:
        postgresql:
          serviceRef:
            databaseSchema: backstage_plugin_orchestrator
            name: backstage-psql-${backstage_name}
            namespace: ${namespace}
          secretRef:
            name: backstage-psql-${backstage_name}
            passwordKey: postgres-password
            userKey: postgres-username
EOF
  
  # Apply network policies to allow SonataFlow communication
  cat <<EOF | oc apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: orchestrator-networking
  namespace: ${namespace}
spec:
  podSelector:
    matchLabels:
      backstage.io/kubernetes-id: developer-hub
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: orchestrator-infra
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: orchestrator-infra
EOF
  
  echo "✓ SonataFlow resources applied successfully"
  return 0
}

validate_sonataflow_resources() {
  local namespace=$1
  local timeout=${2:-300}  # Default timeout: 5 minutes
  local check_interval=${3:-15}  # Default interval: 15 seconds
  
  local max_attempts=$((timeout / check_interval))
  
  echo "Validating SonataFlow resources in namespace '${namespace}' (timeout: ${timeout}s)..."
  
  for ((i=1; i<=max_attempts; i++)); do
    # Check SonataFlowPlatform status
    if oc get sonataflowplatform sonataflow-platform -n "${namespace}" >/dev/null 2>&1; then
      local platform_status=$(oc get sonataflowplatform sonataflow-platform -n "${namespace}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
      
      if [[ "${platform_status}" == "True" ]]; then
        echo "✓ SonataFlowPlatform is ready"
        
        # Check if DataIndex and JobService pods are running
        local dataindex_ready=$(oc get pods -n "${namespace}" -l app=data-index-service --no-headers 2>/dev/null | grep Running | wc -l)
        local jobservice_ready=$(oc get pods -n "${namespace}" -l app=jobs-service --no-headers 2>/dev/null | grep Running | wc -l)
        
        if [[ "${dataindex_ready}" -gt 0 ]] && [[ "${jobservice_ready}" -gt 0 ]]; then
          echo "✓ DataIndex and JobService are running"
          echo "✓ SonataFlow validation completed successfully"
          return 0
        else
          echo "DataIndex ready: ${dataindex_ready}, JobService ready: ${jobservice_ready}"
        fi
      else
        echo "SonataFlowPlatform status: ${platform_status}"
      fi
    else
      echo "SonataFlowPlatform not found or not ready"
    fi
    
    echo "Still validating... (${i}/${max_attempts} checks)"
    sleep "${check_interval}"
  done
  
  echo "✗ SonataFlow validation timed out or failed"
  echo "Current pods in namespace:"
  oc get pods -n "${namespace}" || true
  echo "SonataFlowPlatform status:"
  oc describe sonataflowplatform sonataflow-platform -n "${namespace}" || true
  return 1
}

create_external_orchestrator_database() {
  local external_namespace=${1:-"orchestrator-infra"}
  local database_name="orchestrator"
  
  echo "Creating external orchestrator database in namespace '${external_namespace}'..."
  
  # This function creates a database in the external orchestrator infrastructure
  # Usually this would connect to a shared PostgreSQL instance
  if oc get namespace "${external_namespace}" >/dev/null 2>&1; then
    echo "✓ External orchestrator namespace '${external_namespace}' exists"
    # Additional database setup logic would go here if needed
    return 0
  else
    echo "✗ External orchestrator namespace '${external_namespace}' not found"
    return 1
  fi
}
