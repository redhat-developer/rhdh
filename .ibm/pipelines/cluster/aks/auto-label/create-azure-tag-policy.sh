#!/bin/bash

set -euo pipefail

# === Required ENV variables ===
: "${ARM_CLIENT_ID:?Must set ARM_CLIENT_ID}"
: "${ARM_CLIENT_SECRET:?Must set ARM_CLIENT_SECRET}"
: "${ARM_TENANT_ID:?Must set ARM_TENANT_ID}"
: "${ARM_SUBSCRIPTION_ID:?Must set ARM_SUBSCRIPTION_ID}"

echo ">>> Logging into Azure using Service Principal..."
az login --service-principal -u "$ARM_CLIENT_ID" -p "$ARM_CLIENT_SECRET" --tenant "$ARM_TENANT_ID" > /dev/null

echo ">>> Setting subscription..."
az account set --subscription "$ARM_SUBSCRIPTION_ID"

echo ">>> Creating Azure Policy Definition for required tags..."

# Check if policy exists and remove it if it does
if az policy definition show --name "require-tags-rhdh" --subscription "$ARM_SUBSCRIPTION_ID" > /dev/null 2>&1; then
  echo ">>> Policy 'require-tags-rhdh' already exists. Removing it first..."
  az policy definition delete --name "require-tags-rhdh" --subscription "$ARM_SUBSCRIPTION_ID"
fi

# Create the policy rules JSON file
cat > azure-policy-rules.json << EOF
{
  "if": {
    "anyOf": [
      {
        "field": "tags['app-code']",
        "exists": "false"
      },
      {
        "field": "tags['service-phase']",
        "exists": "false"
      },
      {
        "field": "tags['cost-center']",
        "exists": "false"
      }
    ]
  },
  "then": {
    "effect": "deny"
  }
}
EOF

# Apply the policy without parameters (since we're only checking for tag existence)
az policy definition create \
  --name "require-tags-rhdh" \
  --display-name "Require RHDH standard tags" \
  --description "Ensure all resources have the tags: app-code, service-phase, cost-center" \
  --rules azure-policy-rules.json \
  --mode All \
  --subscription "$ARM_SUBSCRIPTION_ID"

echo ">>> Policy created successfully: 'require-tags-rhdh'"

# Clean up temporary files
rm -f azure-policy-rules.json

echo ">>> Temporary files cleaned up"
