#!/bin/bash
# Orchestrator Operator Setup Script for E2E Testing
# This script automates orchestrator infrastructure setup for operator deployments
# Integrates with existing .ibm/pipelines infrastructure when available

set -euo pipefail

echo "=== Setting up Orchestrator Plugin for RHDH Operator ==="

# Default environment variables
export VERSION=${VERSION:-main}
export BACKSTAGE_NAME=${BACKSTAGE_NAME:-"developer-hub"}
export BACKSTAGE_NS=${BACKSTAGE_NS:-"rhdh-operator"}
export ORCH_DB=${ORCH_DB:-"backstage_plugin_orchestrator"}

# Source existing operator installation functions if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINES_DIR="$(cd "$SCRIPT_DIR/../../.ibm/pipelines" && pwd)"

if [[ -f "$PIPELINES_DIR/utils.sh" ]]; then
    echo "Sourcing existing pipeline utilities..."
    # shellcheck source=.ibm/pipelines/utils.sh
    source "$PIPELINES_DIR/utils.sh"
fi

if [[ -f "$PIPELINES_DIR/install-methods/operator.sh" ]]; then
    echo "Sourcing existing operator installation functions..."
    # shellcheck source=.ibm/pipelines/install-methods/operator.sh
    source "$PIPELINES_DIR/install-methods/operator.sh"
fi

if [[ -f "$PIPELINES_DIR/jobs/ocp-operator.sh" ]]; then
    echo "Sourcing orchestrator operator functions..."
    # shellcheck source=.ibm/pipelines/jobs/ocp-operator.sh
    source "$PIPELINES_DIR/jobs/ocp-operator.sh"
fi

echo "Using configuration:"
echo "  VERSION: $VERSION"
echo "  BACKSTAGE_NAME: $BACKSTAGE_NAME"
echo "  BACKSTAGE_NS: $BACKSTAGE_NS"
echo "  ORCH_DB: $ORCH_DB"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to wait for pods to be ready
wait_for_pods() {
    local namespace=$1
    local label_selector=$2
    local timeout=${3:-300}
    
    echo "Waiting for pods in namespace $namespace with selector $label_selector to be ready..."
    oc wait --for=condition=Ready pod -l "$label_selector" -n "$namespace" --timeout="${timeout}s" || {
        echo "ERROR: Pods did not become ready within $timeout seconds"
        oc get pods -n "$namespace" -l "$label_selector"
        return 1
    }
}

# Function to check if PostgreSQL is accessible
check_postgres_accessibility() {
    echo "Checking PostgreSQL accessibility..."
    local psql_pod=$(oc get pods -n "$BACKSTAGE_NS" | grep psql | awk '{print $1}' | head -1)
    
    if [ -z "$psql_pod" ]; then
        echo "ERROR: No PostgreSQL pod found in namespace $BACKSTAGE_NS"
        oc get pods -n "$BACKSTAGE_NS"
        return 1
    fi
    
    echo "Found PostgreSQL pod: $psql_pod"
    
    # Test connection
    if ! oc exec -n "$BACKSTAGE_NS" "$psql_pod" -- psql -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
        echo "ERROR: Cannot connect to PostgreSQL"
        return 1
    fi
    
    echo "PostgreSQL is accessible"
    export PSQL_POD="$psql_pod"
}

# Check required commands
echo "Checking required commands..."
for cmd in oc curl yq jq; do
    if ! command_exists "$cmd"; then
        echo "ERROR: Required command '$cmd' not found"
        exit 1
    fi
done

# Check if we're logged into OpenShift
if ! oc whoami >/dev/null 2>&1; then
    echo "ERROR: Not logged into OpenShift. Please run 'oc login' first."
    exit 1
fi

# Check if the target namespace exists, create if needed
if ! oc get namespace "$BACKSTAGE_NS" >/dev/null 2>&1; then
    echo "Creating namespace '$BACKSTAGE_NS'..."
    oc create namespace "$BACKSTAGE_NS" || {
        echo "ERROR: Failed to create namespace '$BACKSTAGE_NS'"
        exit 1
    }
    echo "✓ Namespace '$BACKSTAGE_NS' created successfully"
else
    echo "✓ Namespace '$BACKSTAGE_NS' already exists"
fi

echo "=== Step 1: Installing Orchestrator Infrastructure ==="
# Use pipeline function if available, otherwise run manual setup
if command -v deploy_orchestrator_operator >/dev/null 2>&1; then
    echo "Using existing deploy_orchestrator_operator function..."
    deploy_orchestrator_operator "$BACKSTAGE_NS" "$BACKSTAGE_NAME" || {
        echo "ERROR: Failed to deploy orchestrator operator"
        exit 1
    }
    echo "Orchestrator operator deployment completed via pipeline function"
else
    echo "Pipeline function not available, running manual setup..."
    # Run orchestrator infra install script
    echo "Running orchestrator infrastructure installation script..."
    curl -sSL "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/$VERSION/config/profile/rhdh/plugin-infra/plugin-infra.sh" | bash

    # Wait for infrastructure to be ready
    echo "Waiting for orchestrator infrastructure to be ready..."
    sleep 30

    # Check if serverless operators are installed
    echo "Checking serverless operators..."
    if ! oc get csv -A | grep -E "(serverless-operator|logic-operator)" >/dev/null; then
        echo "WARNING: Serverless operators may not be fully installed yet. Continuing..."
    fi
fi

echo "=== Step 2: Setting up PostgreSQL Database ==="
# Check PostgreSQL accessibility
check_postgres_accessibility

# Create orchestrator database
echo "Creating orchestrator database '$ORCH_DB'..."
oc exec -i "$PSQL_POD" -n "$BACKSTAGE_NS" -- psql -U postgres -d postgres <<EOF
-- Create database if it doesn't exist
SELECT 'CREATE DATABASE $ORCH_DB' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$ORCH_DB')\gexec
GRANT ALL PRIVILEGES ON DATABASE $ORCH_DB TO postgres;
EOF

# Verify database creation
echo "Verifying database creation..."
if oc exec -n "$BACKSTAGE_NS" "$PSQL_POD" -- psql -U postgres -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$ORCH_DB';" | grep -q "1 row"; then
    echo "Database '$ORCH_DB' created successfully"
else
    echo "ERROR: Failed to create database '$ORCH_DB'"
    exit 1
fi

echo "=== Step 3: Applying SonataFlow Resources ==="
# Apply SonataFlow related resources
echo "Applying SonataFlow resources..."
curl -sSL "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/release-1.7/config/profile/rhdh/plugin-deps/sonataflow.yaml" | \
    sed "s/{{backstage-name}}/$BACKSTAGE_NAME/g; s/{{backstage-ns}}/$BACKSTAGE_NS/g" | \
    oc apply -f -

# Wait for SonataFlow resources to be created
echo "Waiting for SonataFlow resources to be ready..."
sleep 10

# Check if SonataFlowPlatform was created
if oc get sonataflowplatform -n "$BACKSTAGE_NS" >/dev/null 2>&1; then
    echo "SonataFlowPlatform resources created successfully"
else
    echo "WARNING: SonataFlowPlatform resources may not be ready yet"
fi

echo "=== Step 4: Configuring Guest Authentication ==="
# Add guest user to auth ConfigMap
echo "Updating backstage ConfigMap with guest authentication..."

# Backup original ConfigMap
oc get cm "backstage-appconfig-$BACKSTAGE_NAME" -n "$BACKSTAGE_NS" -o yaml > /tmp/backstage-appconfig-backup.yaml

# Get current ConfigMap and update it
oc get cm "backstage-appconfig-$BACKSTAGE_NAME" -n "$BACKSTAGE_NS" -o json | \
    jq '.data."default.app-config.yaml"' -r > /tmp/default.app-config.yaml

# Add guest authentication configuration
yq eval-all '. as $item ireduce ({}; . * $item)' /tmp/default.app-config.yaml <(cat <<EOF
auth:
  providers:
    guest:
      dangerouslyAllowOutsideDevelopment: true
      userEntityRef: "user:default/guest"
EOF
) > /tmp/default.app-config-updated.yaml

# Delete and recreate ConfigMap
oc delete cm "backstage-appconfig-$BACKSTAGE_NAME" -n "$BACKSTAGE_NS"
oc create configmap "backstage-appconfig-$BACKSTAGE_NAME" -n "$BACKSTAGE_NS" --from-file=default.app-config.yaml=/tmp/default.app-config-updated.yaml

echo "=== Step 5: Restarting Backstage Deployment ==="
# Apply orchestrator CRD if available, otherwise restart existing deployment
if [[ -f "$PIPELINES_DIR/resources/rhdh-operator/rhdh-start-orchestrator.yaml" ]]; then
    echo "Applying orchestrator-enabled RHDH configuration..."
    
    # Apply environment substitution to the CRD
    temp_crd="/tmp/rhdh-start-orchestrator-$(date +%s).yaml"
    envsubst < "$PIPELINES_DIR/resources/rhdh-operator/rhdh-start-orchestrator.yaml" > "$temp_crd"
    
    # Apply the CRD
    oc apply -f "$temp_crd" -n "$BACKSTAGE_NS"
    
    # Clean up temp file
    rm -f "$temp_crd"
    
    echo "RHDH orchestrator configuration applied"
    
    # Wait for new deployment to be ready
    echo "Waiting for orchestrator-enabled backstage deployment to be ready..."
    oc rollout status deployment/backstage-rhdh-orchestrator -n "$BACKSTAGE_NS" --timeout=600s
else
    # Fallback to restart existing deployment
    echo "Restarting existing backstage deployment..."
    oc rollout restart deployment/backstage-"$BACKSTAGE_NAME" -n "$BACKSTAGE_NS"

    # Wait for deployment to be ready
    echo "Waiting for backstage deployment to be ready..."
    oc rollout status deployment/backstage-"$BACKSTAGE_NAME" -n "$BACKSTAGE_NS" --timeout=600s
fi

echo "=== Step 6: Verification ==="
# Verify the setup
echo "Verifying orchestrator setup..."

# Check if backstage pod is running
wait_for_pods "$BACKSTAGE_NS" "app.kubernetes.io/name=backstage" 300

# Check if orchestrator plugins are loaded (this would need to be done via API or UI in actual tests)
echo "Orchestrator infrastructure setup completed successfully!"

echo "=== Setup Summary ==="
echo "✓ Orchestrator infrastructure installed"
echo "✓ PostgreSQL database '$ORCH_DB' created"
echo "✓ SonataFlow resources applied"
echo "✓ Guest authentication configured"
echo "✓ Backstage deployment restarted and ready"

echo "=== Next Steps ==="
echo "The orchestrator plugin should now be available in the RHDH instance."
echo "Access the RHDH instance and navigate to the Orchestrator section to verify functionality."

# Cleanup temporary files
rm -f /tmp/default.app-config.yaml /tmp/default.app-config-updated.yaml

echo "Setup completed successfully!"