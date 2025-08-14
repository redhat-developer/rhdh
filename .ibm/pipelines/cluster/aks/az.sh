#!/bin/bash

# These functions were used to interact with Azure CLI in the context of an AKS cluster.
# Since we switched to an ephemeral AKS cluster, these functions are no longer used.
# They are kept here for reference and may be reused for ARO cluster.
# Make sure to set the required environment variables before using these functions.

az_login() {
  az login --service-principal -u $ARM_CLIENT_ID -p $ARM_CLIENT_SECRET --tenant $ARM_TENANT_ID
  az account set --subscription $ARM_SUBSCRIPTION_ID
}

az_aks_start() {
  local name=$1
  local resource_group=$2

  local power_state
  power_state=$(az aks show --name=$name --resource-group $resource_group --query 'powerState.code' -o tsv)

  if [ "$power_state" == "Running" ]; then
    echo "AKS cluster is running."
  else
    echo "AKS cluster is not running (Current state: $power_state). Starting the cluster."
    az aks start --name $name --resource-group $resource_group
  fi
}

az_aks_stop() {
  local name=$1
  local resource_group=$2
  az aks stop --name $name --resource-group $resource_group
}

az_aks_approuting_enable() {
  local name=$1
  local resource_group=$2
  set +e
  local output
  output=$(az aks approuting enable --name $name --resource-group $resource_group 2>&1 | sed 's/^ERROR: //')
  set -e
  exit_status=$?

  if [ $exit_status -ne 0 ]; then
    if [[ "$output" == *"App Routing is already enabled"* ]]; then
      echo "App Routing is already enabled. Continuing..."
    else
      echo "Error: $output"
      exit 1
    fi
  fi
}

az_aks_get_credentials() {
  local name=$1
  local resource_group=$2
  az aks get-credentials --name="${name}" --resource-group="${resource_group}" --overwrite-existing
}