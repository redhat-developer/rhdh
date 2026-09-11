#!/usr/bin/env bash
#
# Run on: LOCAL MACHINE (workstation with Azure CLI installed).
# Purpose: Create the application rules required by an ARO disconnected cluster.
# Based on: https://github.com/redhat-cop/ocp-disconnected-docs/blob/main/AROInstall.md
# Requires: An ARO cluster and Azure Firewall created by install-aro-disconnected.sh.
#

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

print_status() {
  printf '[INFO] %s\n' "$1"
}

print_warning() {
  printf '[WARNING] %s\n' "$1"
}

print_error() {
  printf '[ERROR] %s\n' "$1" >&2
}

if [[ ! -f "${SCRIPT_DIR}/.env" ]]; then
  print_error 'Missing .env. Copy .env.example to .env and edit it first.'
  exit 1
fi

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/.env"

if [[ -z "${RESOURCEGROUP:-}" || -z "${FIREWALL_NAME:-}" || -z "${FIREWALL_COLLECTION_NAME:-}" ]]; then
  print_error 'RESOURCEGROUP, FIREWALL_NAME, and FIREWALL_COLLECTION_NAME are required.'
  exit 1
fi

RESOURCE_GROUP="$RESOURCEGROUP"
RULE_COLLECTION_NAME="$FIREWALL_COLLECTION_NAME"
SOURCE_ADDRESSES=(10.0.0.0/24 10.0.1.0/24)
PROTOCOLS=(Http=80 Https=443)
RULE_NAMES=(
  azure
  redhat
  ms-graph
  github
  gitlab
  pagerduty
  quay
  okta
  auth0
  atlassian
  atlassian-third-party
)
RULE_TARGETS=(
  'management.azure.com mirror.openshift.com login.microsoftonline.com gcs.prod.monitoring.core.windows.net *.blob.core.windows.net *.servicebus.windows.net *.table.core.windows.net'
  '*.redhat.com redhat.com redhat.io *.redhat.io'
  'graph.microsoft.com'
  '*.github.com github.com *.githubusercontent.com'
  'gitlab.com *.gitlab.com *.gitlab.io'
  '*.pagerduty.com pagerduty.com'
  'quay.io *.quay.io'
  '*.okta.com *.mtls.okta.com *.oktapreview.com *.mtls.oktapreview.com *.oktacdn.com *.okta-emea.com *.mtls.okta-emea.com *.kerberos.okta.com *.kerberos.okta-emea.com *.kerberos.oktapreview.com *.okta-gov.com *.mtls.okta-gov.com *.okta.mil *.mtls.okta.mil *.awsglobalaccelerator.com'
  'auth0.com *.auth0.com'
  '*.atlassian.com atlassian.com'
  '*.pndsn.com *.cloudfront.net *.wp.com *.gravatar.com *.googleapis.com'
)

check_prerequisites() {
  print_status 'Checking prerequisites'
  if ! command -v az > /dev/null 2>&1; then
    print_error 'Azure CLI is not installed.'
    exit 1
  fi
  if ! az account show > /dev/null 2>&1; then
    print_error "Not logged in to Azure. Run 'az login' first."
    exit 1
  fi
}

check_firewall() {
  print_status "Checking firewall: ${FIREWALL_NAME}"
  if ! az network firewall show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FIREWALL_NAME" > /dev/null; then
    print_error "Firewall '${FIREWALL_NAME}' not found in resource group '${RESOURCE_GROUP}'."
    exit 1
  fi
}

check_existing_rule_collection() {
  print_status "Checking rule collection: ${RULE_COLLECTION_NAME}"
  if ! az network firewall application-rule collection show \
    --resource-group "$RESOURCE_GROUP" \
    --firewall-name "$FIREWALL_NAME" \
    --collection-name "$RULE_COLLECTION_NAME" > /dev/null 2>&1; then
    print_status "Rule collection '${RULE_COLLECTION_NAME}' does not exist."
    return
  fi

  print_warning "Rule collection '${RULE_COLLECTION_NAME}' already exists."
  read -r -p 'Overwrite it? (y/N): ' -n 1 REPLY || REPLY=''
  printf '\n'
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    print_status 'Operation cancelled.'
    exit 0
  fi

  print_status "Removing existing rule collection: ${RULE_COLLECTION_NAME}"
  az network firewall application-rule collection delete \
    --resource-group "$RESOURCE_GROUP" \
    --firewall-name "$FIREWALL_NAME" \
    --collection-name "$RULE_COLLECTION_NAME"
}

create_application_rule() {
  local rule_name="$1"
  local target_definition="$2"
  local rule_index="$3"
  local -a target_fqdns
  local -a command

  read -r -a target_fqdns <<< "$target_definition"
  command=(
    az network firewall application-rule create
    --resource-group "$RESOURCE_GROUP"
    --firewall-name "$FIREWALL_NAME"
    --collection-name "$RULE_COLLECTION_NAME"
    --name "$rule_name"
    --target-fqdns "${target_fqdns[@]}"
    --source-addresses "${SOURCE_ADDRESSES[@]}"
    --protocols "${PROTOCOLS[@]}"
  )

  if [[ "$rule_index" -eq 0 ]]; then
    command+=(--action Allow --priority 200)
  fi

  print_status "Adding firewall rule: ${rule_name}"
  "${command[@]}"
}

create_rule_collection() {
  print_status "Creating firewall rule collection: ${RULE_COLLECTION_NAME}"
  if [[ "${#RULE_NAMES[@]}" -ne "${#RULE_TARGETS[@]}" ]]; then
    print_error 'Firewall rule names and target definitions are out of sync.'
    exit 1
  fi

  for rule_index in "${!RULE_NAMES[@]}"; do
    create_application_rule \
      "${RULE_NAMES[$rule_index]}" \
      "${RULE_TARGETS[$rule_index]}" \
      "$rule_index"
  done
}

check_prerequisites
check_firewall
check_existing_rule_collection
create_rule_collection
print_status "Rule collection '${RULE_COLLECTION_NAME}' created successfully."
