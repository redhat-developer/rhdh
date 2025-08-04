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

  wait_for_backstage_crd "$namespace"
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
  
  echo "Waiting for Backstage deployment to be ready..."
  
  # Step 1: Wait for deployment to have ready replicas
  timeout 600 bash -c "
  while ! oc get deployment/backstage-${backstage_name} -n '${namespace}' >/dev/null 2>&1 || \
        [[ \$(oc get deployment/backstage-${backstage_name} -n '${namespace}' -o jsonpath='{.status.readyReplicas}') != '1' ]]; do
      echo 'Waiting for Backstage deployment to be ready...'
      sleep 10
  done
  echo 'Backstage deployment has ready replicas.'
  " || { echo "Error: Timed out waiting for Backstage deployment."; return 1; }
  
  # Step 2: Wait for pod to be actually ready and serving requests
  echo "Waiting for Backstage pod to be ready and serving requests..."
  local backstage_pod=""
  for attempt in {1..60}; do
    backstage_pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=backstage" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [[ -n "${backstage_pod}" ]]; then
      echo "Found running Backstage pod: ${backstage_pod} (attempt ${attempt})"
      break
    fi
    echo "Waiting for Backstage pod to be running... (attempt ${attempt}/60)"
    sleep 10
  done
  
  if [[ -z "${backstage_pod}" ]]; then
    echo "Error: No running Backstage pod found after 10 minutes"
    return 1
  fi
  
  # Step 3: Wait for Backstage API to respond
  echo "Waiting for Backstage API to respond..."
  for attempt in {1..30}; do
    if oc exec "${backstage_pod}" -n "${namespace}" -- curl -s -f localhost:7007/healthcheck >/dev/null 2>&1; then
      echo "✓ Backstage API is responding (attempt ${attempt})"
      break
    fi
    echo "Waiting for Backstage API to respond... (attempt ${attempt}/30)"
    sleep 10
  done
  
  # Final verification
  if oc exec "${backstage_pod}" -n "${namespace}" -- curl -s -f localhost:7007/healthcheck >/dev/null 2>&1; then
    echo "✓ Backstage is fully ready and serving requests"
    return 0
  else
    echo "✗ Error: Backstage API is not responding after all checks"
    return 1
  fi
}

create_sonataflow_database() {
  local namespace=$1
  local database_name=$2  
  local postgres_service=$3
  
  echo "Creating SonataFlow database: ${database_name} in namespace: ${namespace}"
  
  # Wait for PostgreSQL pod to be ready (more robust detection)
  local psql_pod=""
  for attempt in {1..30}; do
    # Try the RHDH-specific PostgreSQL pods first
    psql_pod=$(oc get pods -n "${namespace}" --field-selector=status.phase=Running -o name 2>/dev/null | grep "backstage-psql" | head -n1 | cut -d'/' -f2)
    if [[ -n "${psql_pod}" ]]; then
      echo "Found running PostgreSQL pod: ${psql_pod} (attempt ${attempt})"
      break
    fi
    # Fallback to generic postgresql label
    psql_pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=postgresql" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [[ -n "${psql_pod}" ]]; then
      echo "Found running PostgreSQL pod: ${psql_pod} (attempt ${attempt})"
      break
    fi
    echo "Waiting for PostgreSQL pod to be ready... (attempt ${attempt}/30)"
    sleep 10
  done
  
  if [[ -n "${psql_pod}" ]]; then
    echo "Creating database using internal PostgreSQL pod: ${psql_pod}"
    
    # Check if database already exists first
    local existing_db=$(oc exec -i "${psql_pod}" -n "${namespace}" -- psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${database_name}';" 2>/dev/null || echo "")
    
    if [[ "${existing_db}" == "1" ]]; then
      echo "Database ${database_name} already exists - skipping creation"
    else
      # Create database using internal PostgreSQL pod
      if oc exec -i "${psql_pod}" -n "${namespace}" -- psql -U postgres -d postgres <<EOF
CREATE DATABASE ${database_name};
GRANT ALL PRIVILEGES ON DATABASE ${database_name} TO postgres;
\q
EOF
      then
        echo "Database ${database_name} created successfully in internal PostgreSQL"
        # Verify creation
        local verify_db=$(oc exec -i "${psql_pod}" -n "${namespace}" -- psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${database_name}';" 2>/dev/null || echo "")
        if [[ "${verify_db}" == "1" ]]; then
          echo "Database creation verified successfully"
        else
          echo "Warning: Database creation verification failed"
        fi
      else
        echo "Error: Failed to create database ${database_name}"
        return 1
      fi
    fi
  else
    echo "No internal PostgreSQL pod found after 5 minutes. Attempting external PostgreSQL database creation..."
    create_external_orchestrator_database "${namespace}" "${database_name}"
  fi
}

create_external_orchestrator_database() {
  local namespace=$1
  local database_name=$2
  
  echo "Creating orchestrator database in external PostgreSQL for namespace: ${namespace}"
  
  # Check if postgres credentials secret exists
  if ! oc get secret postgres-cred -n "${namespace}" >/dev/null 2>&1; then
    echo "Warning: postgres-cred secret not found in ${namespace}. Skipping external database creation."
    return 0
  fi
  
  # Extract PostgreSQL connection details from secret
  local postgres_host=$(oc get secret postgres-cred -n "${namespace}" -o jsonpath='{.data.POSTGRES_HOST}' | base64 -d)
  local postgres_user=$(oc get secret postgres-cred -n "${namespace}" -o jsonpath='{.data.POSTGRES_USER}' | base64 -d)
  local postgres_password=$(oc get secret postgres-cred -n "${namespace}" -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
  
  if [[ -z "${postgres_host}" || -z "${postgres_user}" || -z "${postgres_password}" ]]; then
    echo "Warning: Missing PostgreSQL connection details in postgres-cred secret. Skipping database creation."
    return 0
  fi
  
  echo "Connecting to external PostgreSQL at: ${postgres_host}"
  
  # Create a temporary pod to run psql commands against external database
  cat <<EOF | oc apply -f - -n "${namespace}"
apiVersion: v1
kind: Pod
metadata:
  name: postgres-client-temp
  namespace: ${namespace}
spec:
  restartPolicy: Never
  containers:
  - name: postgres-client
    image: postgres:15
    command: ['sleep', '300']
    env:
    - name: PGHOST
      value: "${postgres_host}"
    - name: PGUSER
      value: "${postgres_user}"
    - name: PGPASSWORD
      value: "${postgres_password}"
    - name: PGPORT
      value: "5432"
EOF
  
  # Wait for pod to be ready
  echo "Waiting for PostgreSQL client pod to be ready..."
  oc wait --for=condition=Ready pod/postgres-client-temp -n "${namespace}" --timeout=60s
  
  # Create the database
  if oc exec postgres-client-temp -n "${namespace}" -- psql -d postgres -c "CREATE DATABASE ${database_name};" 2>/dev/null; then
    echo "Database ${database_name} created successfully in external PostgreSQL"
    oc exec postgres-client-temp -n "${namespace}" -- psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE ${database_name} TO ${postgres_user};" 2>/dev/null
    echo "Granted privileges on ${database_name} to ${postgres_user}"
  else
    echo "Database ${database_name} may already exist or creation failed (continuing anyway)"
  fi
  
  # Cleanup temporary pod
  oc delete pod postgres-client-temp -n "${namespace}" --ignore-not-found
  
  echo "External PostgreSQL database setup completed"
}

apply_sonataflow_resources() {
  local namespace=$1
  local backstage_name=$2
  
  echo "Applying SonataFlow resources..."
  
  # Download and apply SonataFlow resources with variable substitution using RELEASE_BRANCH_NAME
  curl -sSL "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/config/profile/rhdh/plugin-deps/sonataflow.yaml" | \
    sed "s/{{backstage-name}}/${backstage_name}/g; s/{{backstage-ns}}/${namespace}/g" | \
    oc apply -f - -n "${namespace}"
  
  echo "SonataFlow resources applied successfully"
}

validate_sonataflow_resources() {
  local namespace=$1
  
  echo "Validating SonataFlow resources in namespace: ${namespace}"
  
  # Wait for SonataFlowPlatform to be ready
  echo "Waiting for SonataFlowPlatform to be ready..."
  timeout 300 bash -c "
  while ! oc get sonataflowplatform/sonataflow-platform -n '${namespace}' >/dev/null 2>&1 || \
        [[ \$(oc get sonataflowplatform/sonataflow-platform -n '${namespace}' -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].status}') != 'True' ]]; do
      echo 'Waiting for SonataFlowPlatform to be ready...'
      sleep 10
  done
  echo 'SonataFlowPlatform is ready.'
  " || { echo "Warning: SonataFlowPlatform not ready within timeout, continuing..."; }
  
  # Verify network policies are applied
  echo "Checking network policies..."
  local np_count=$(oc get networkpolicy -n "${namespace}" --no-headers | wc -l)
  if [[ $np_count -ge 4 ]]; then
    echo "Network policies applied successfully (${np_count} policies found)"
  else
    echo "Warning: Expected 4 network policies, found ${np_count}"
  fi
  
  # Check DataIndex and JobService pods
  echo "Checking orchestrator service pods..."
  timeout 180 bash -c "
  while [[ \$(oc get pods -n '${namespace}' -l 'app.kubernetes.io/part-of=sonataflow-platform' --field-selector=status.phase=Running --no-headers | wc -l) -lt 2 ]]; do
      echo 'Waiting for DataIndex and JobService pods to be running...'
      sleep 15
  done
  echo 'Orchestrator service pods are running.'
  " || { echo "Warning: Not all orchestrator service pods ready within timeout, continuing..."; }
  
  echo "SonataFlow validation completed"
}
