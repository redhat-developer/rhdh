#!/bin/bash
# Script to extract values needed for schema mode test

NAMESPACE="${NAMESPACE:-rhdh-operator}"
RELEASE_NAME="${RELEASE_NAME:-developer-hub}"

echo "🔍 Extracting values from OCP cluster..."
echo ""

# Get PostgreSQL pod IP
PG_POD_IP=$(oc get pod backstage-psql-${RELEASE_NAME}-0 -n ${NAMESPACE} -o jsonpath='{.status.podIP}' 2>/dev/null)
if [ -z "$PG_POD_IP" ]; then
  echo "❌ Could not find PostgreSQL pod: backstage-psql-${RELEASE_NAME}-0"
  exit 1
fi

# Get service name (for cluster-internal access)
PG_SERVICE="backstage-psql-${RELEASE_NAME}.${NAMESPACE}.svc.cluster.local"

# Try to get password from pod environment or secret
PG_PASSWORD=$(oc exec backstage-psql-${RELEASE_NAME}-0 -n ${NAMESPACE} -- env 2>/dev/null | grep POSTGRESQL_ADMIN_PASSWORD | cut -d'=' -f2)
if [ -z "$PG_PASSWORD" ]; then
  # Try from secret
  PG_PASSWORD=$(oc get secret backstage-psql-${RELEASE_NAME} -n ${NAMESPACE} -o jsonpath='{.data.postgresql-password}' 2>/dev/null | base64 -d)
fi
if [ -z "$PG_PASSWORD" ]; then
  PG_PASSWORD="postgres"  # Default
  echo "⚠️  Could not find password, using default: postgres"
fi

echo "✅ Values extracted:"
echo ""
echo "export SCHEMA_MODE_DB_HOST=\"${PG_POD_IP}\""
echo "export SCHEMA_MODE_DB_ADMIN_USER=\"postgres\""
echo "export SCHEMA_MODE_DB_ADMIN_PASSWORD=\"${PG_PASSWORD}\""
echo "export SCHEMA_MODE_DB_NAME=\"backstage_schema_test\""
echo "export SCHEMA_MODE_DB_USER=\"backstage_schema_user\""
echo "export SCHEMA_MODE_DB_PASSWORD=\"test_password_123\""
echo "export NAME_SPACE_RUNTIME=\"${NAMESPACE}\""
echo "export RELEASE_NAME=\"${RELEASE_NAME}\""
echo "export JOB_NAME=\"operator\""
echo ""
echo "💡 To use these values, run:"
echo "   source <(./get-test-values.sh)"
echo ""
echo "📝 Note: If pod IP (${PG_POD_IP}) is not accessible from your machine, use port-forward:"
echo "   oc port-forward -n ${NAMESPACE} backstage-psql-${RELEASE_NAME}-0 5432:5432"
echo "   Then set: export SCHEMA_MODE_DB_HOST=localhost"
