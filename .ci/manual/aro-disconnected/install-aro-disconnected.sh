#!/usr/bin/env bash
#
# Run on: LOCAL MACHINE (workstation with Azure CLI installed).
# Purpose: Create a resource group, VNet, Azure Firewall, ARO cluster, and bastion host.
# Based on: https://github.com/redhat-cop/ocp-disconnected-docs/blob/main/AROInstall.md
#

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

require_command() {
  if ! command -v "$1" > /dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$SCRIPT_DIR" "$1" ;;
  esac
}

require_command az
require_command ssh-keygen

if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
  printf 'Missing .env. Copy .env.example to .env and edit it first.\n' >&2
  exit 1
fi

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/.env"

required_variables=(
  BASE_NAME
  LOCATION
  RESOURCEGROUP
  CLUSTER
  VNET_NAME
  FIREWALL_NAME
  FIREWALL_COLLECTION_NAME
  FIREWALL_ALLOWED_LIST_BASE
  FIREWALL_ALLOWED_LIST_INSTALL
  BASTION_IMAGE
  SSH_KEY_NAME
  WORKER_COUNT
  PULL_SECRET_FILE
  OPENSHIFT_VERSION
  BASTION_NAME
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Required variable is empty: %s\n' "$variable_name" >&2
    exit 1
  fi
done

PULL_SECRET_FILE=$(resolve_path "$PULL_SECRET_FILE")
SSH_KEY_NAME=$(resolve_path "$SSH_KEY_NAME")
ACCESS_INFORMATION_FILE="${SCRIPT_DIR}/${BASE_NAME}_access-information.txt"
FIREWALL_ALLOWED_LIST_BASE_ARRAY=()
FIREWALL_ALLOWED_LIST_INSTALL_ARRAY=()
read -r -a FIREWALL_ALLOWED_LIST_BASE_ARRAY <<< "$FIREWALL_ALLOWED_LIST_BASE"
read -r -a FIREWALL_ALLOWED_LIST_INSTALL_ARRAY <<< "$FIREWALL_ALLOWED_LIST_INSTALL"

if [[ ! -f "$PULL_SECRET_FILE" ]]; then
  printf 'Pull secret file not found: %s\n' "$PULL_SECRET_FILE" >&2
  exit 1
fi

if [[ -e "$SSH_KEY_NAME" || -e "${SSH_KEY_NAME}.pub" ]]; then
  printf 'SSH key already exists. Set SSH_KEY_NAME to a new path: %s\n' "$SSH_KEY_NAME" >&2
  exit 1
fi

umask 077

printf '%s\n' 'Installing Azure Red Hat OpenShift (ARO) in disconnected Microsoft Azure'

printf '%s\n' 'Checking Azure CLI login'
if ! az account show > /dev/null 2>&1; then
  printf '%s\n' 'Please log in to Azure CLI'
  az login
fi

printf '%s\n' 'Creating resource group'
az group create --location "$LOCATION" --name "$RESOURCEGROUP"

printf '%s\n' 'Creating virtual network'
az network vnet create \
  --resource-group "$RESOURCEGROUP" \
  --name "$VNET_NAME" \
  --address-prefixes 10.0.0.0/16

printf '%s\n' 'Creating master subnet'
az network vnet subnet create \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --name master-subnet \
  --address-prefixes 10.0.0.0/24 \
  --service-endpoints Microsoft.ContainerRegistry

printf '%s\n' 'Creating worker subnet'
az network vnet subnet create \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --name worker-subnet \
  --address-prefixes 10.0.1.0/24 \
  --service-endpoints Microsoft.ContainerRegistry

printf '%s\n' 'Disabling master subnet private endpoint policies'
az network vnet subnet update \
  --name master-subnet \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --disable-private-link-service-network-policies true

printf '%s\n' 'Creating Azure Firewall subnet'
az network vnet subnet create \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --name AzureFirewallSubnet \
  --address-prefixes 10.0.10.0/26

printf '%s\n' 'Creating public subnet for bastion host'
az network vnet subnet create \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --name public-subnet \
  --address-prefixes 10.0.2.0/24

printf '%s\n' 'Creating Azure Firewall'
az network public-ip create \
  --name fw-pip \
  --resource-group "$RESOURCEGROUP" \
  --allocation-method static \
  --sku standard
az extension add --name azure-firewall
az network firewall create \
  --resource-group "$RESOURCEGROUP" \
  --name "$FIREWALL_NAME" \
  --location "$LOCATION"
az network firewall ip-config create \
  --firewall-name "$FIREWALL_NAME" \
  --name FW-config \
  --public-ip-address fw-pip \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME"

fw_private_address=$(az network firewall ip-config list \
  --resource-group "$RESOURCEGROUP" \
  --firewall-name "$FIREWALL_NAME" \
  --query "[?name=='FW-config'].privateIpAddress" \
  --output tsv)
if [[ -z "$fw_private_address" ]]; then
  printf 'Unable to determine the Azure Firewall private IP address.\n' >&2
  exit 1
fi

printf '%s\n' 'Creating routing table'
az network route-table create \
  --name "${FIREWALL_NAME}-rt-table" \
  --resource-group "$RESOURCEGROUP"
az network route-table route create \
  --resource-group "$RESOURCEGROUP" \
  --name "${FIREWALL_NAME}-rt-table-route" \
  --route-table-name "${FIREWALL_NAME}-rt-table" \
  --address-prefix 0.0.0.0/0 \
  --next-hop-type VirtualAppliance \
  --next-hop-ip-address "$fw_private_address"

printf '%s\n' 'Adding Azure Firewall application rules for ARO installation'
az network firewall application-rule create \
  --resource-group "$RESOURCEGROUP" \
  --firewall-name "$FIREWALL_NAME" \
  --collection-name "$FIREWALL_COLLECTION_NAME" \
  --name azure \
  --protocols http=80 https=443 \
  --target-fqdns "${FIREWALL_ALLOWED_LIST_BASE_ARRAY[@]}" \
  --source-addresses 10.0.0.0/24 10.0.1.0/24 \
  --priority 100 \
  --action Allow
az network firewall application-rule create \
  --resource-group "$RESOURCEGROUP" \
  --firewall-name "$FIREWALL_NAME" \
  --collection-name "$FIREWALL_COLLECTION_NAME" \
  --name azure_install \
  --protocols http=80 https=443 \
  --target-fqdns "${FIREWALL_ALLOWED_LIST_INSTALL_ARRAY[@]}" \
  --source-addresses 10.0.0.0/24 10.0.1.0/24

printf '%s\n' 'Routing master and worker traffic through Azure Firewall'
az network vnet subnet update \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --name master-subnet \
  --route-table "${FIREWALL_NAME}-rt-table"
az network vnet subnet update \
  --resource-group "$RESOURCEGROUP" \
  --vnet-name "$VNET_NAME" \
  --name worker-subnet \
  --route-table "${FIREWALL_NAME}-rt-table"

printf '%s\n' 'Creating the ARO cluster in the disconnected network'
az aro create \
  --resource-group "$RESOURCEGROUP" \
  --name "$CLUSTER" \
  --vnet "$VNET_NAME" \
  --master-subnet master-subnet \
  --worker-subnet worker-subnet \
  --apiserver-visibility Private \
  --ingress-visibility Private \
  --version "$OPENSHIFT_VERSION" \
  --worker-count "$WORKER_COUNT" \
  --pull-secret "$PULL_SECRET_FILE"

printf '%s\n' 'Removing the temporary ARO installation firewall rule'
az network firewall application-rule delete \
  --resource-group "$RESOURCEGROUP" \
  --firewall-name "$FIREWALL_NAME" \
  --collection-name "$FIREWALL_COLLECTION_NAME" \
  --name azure_install

printf '%s\n' 'Creating bastion host SSH key pair'
mkdir -p "$(dirname "$SSH_KEY_NAME")"
ssh-keygen -m PEM -t rsa -b 4096 -N '' -f "$SSH_KEY_NAME"
chmod 600 "$SSH_KEY_NAME"

printf '%s\n' 'Creating bastion host VM'
az vm create \
  --name "$BASTION_NAME" \
  --resource-group "$RESOURCEGROUP" \
  --image "$BASTION_IMAGE" \
  --size Standard_D2s_v3 \
  --public-ip-address bastion-pub-ip \
  --vnet-name "$VNET_NAME" \
  --subnet public-subnet \
  --admin-username azureuser \
  --ssh-key-values "${SSH_KEY_NAME}.pub"

printf '%s\n' 'Collecting cluster and bastion access information'
KUBEADMIN_PASSWORD=$(az aro list-credentials \
  --name "$CLUSTER" \
  --resource-group "$RESOURCEGROUP" \
  --query kubeadminPassword \
  --output tsv)
API_SERVER=$(az aro show \
  --resource-group "$RESOURCEGROUP" \
  --name "$CLUSTER" \
  --query apiserverProfile.url \
  --output tsv)
BASTION_PUBLIC_IP=$(az vm show \
  --show-details \
  --resource-group "$RESOURCEGROUP" \
  --name "$BASTION_NAME" \
  --query publicIps \
  --output tsv)
CONSOLE_URL=$(az aro show \
  --resource-group "$RESOURCEGROUP" \
  --name "$CLUSTER" \
  --query consoleProfile.url \
  --output tsv)

: > "$ACCESS_INFORMATION_FILE"
chmod 600 "$ACCESS_INFORMATION_FILE"
{
  printf 'ssh -i %s azureuser@%s\n' "$SSH_KEY_NAME" "$BASTION_PUBLIC_IP"
  printf 'oc login %s -u kubeadmin -p %s\n' "$API_SERVER" "$KUBEADMIN_PASSWORD"
  printf 'CONSOLE_URL=%s\n' "$CONSOLE_URL"
  printf 'API_SERVER=%s\n' "$API_SERVER"
  printf 'KUBEADMIN_PASSWORD=%s\n' "$KUBEADMIN_PASSWORD"
} > "$ACCESS_INFORMATION_FILE"

printf 'Access information written to protected file: %s\n' "$ACCESS_INFORMATION_FILE"
