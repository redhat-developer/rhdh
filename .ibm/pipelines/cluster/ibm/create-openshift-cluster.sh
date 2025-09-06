#!/usr/bin/env bash
set -euo pipefail

# Function to show a numbered menu from a list
show_menu() {
  local prompt="$1"
  shift
  local options=("$@")
  local i=1

  echo "$prompt"
  for opt in "${options[@]}"; do
    echo "  $i) $opt"
    ((i++))
  done

  read -p "Select an option [1-${#options[@]}]: " choice
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || ((choice < 1 || choice > ${#options[@]})); then
    echo "❌ Invalid choice"
    exit 1
  fi

  echo "${options[$((choice - 1))]}"
}

# Login to IBM Cloud
echo "🔐 Logging into IBM Cloud..."

#get IBM_CLOUD_API_KEY from VAULT
ibmcloud login --apikey "$IBM_CLOUD_API_KEY" -g rhdh-rsc-group

# Step 1: Choose Zone
ZONES=$(ibmcloud oc zone ls --output json | jq -r '.[] | .name')
readarray -t zone_list <<< "$ZONES"
ZONE=$(show_menu "🌍 Choose the zone to deploy the cluster:" "${zone_list[@]}")

# Step 2: Choose Flavor
FLAVORS=$(ibmcloud oc flavors --zone "$ZONE" --output json | jq -r '.[].name')
readarray -t flavor_list <<< "$FLAVORS"
FLAVOR=$(show_menu "💻 Choose the flavor (machine type):" "${flavor_list[@]}")

# Step 3: Enter Cluster Name and Version
read -p "🔤 Enter the cluster name: " CLUSTER_NAME
read -p "🧪 Enter OpenShift version (e.g., 4.16_openshift): " OPENSHIFT_VERSION

# Tags to apply
TAGS="app-code:RHDH-003,service-phase:dev,cost-center:726"

# Step 4: Create the cluster
echo "🚀 Creating cluster '$CLUSTER_NAME' in zone '$ZONE' with flavor '$FLAVOR' and version '$OPENSHIFT_VERSION'..."
ibmcloud oc cluster create vpc-gen2 \
  --name "$CLUSTER_NAME" \
  --version "$OPENSHIFT_VERSION" \
  --zone "$ZONE" \
  --flavor "$FLAVOR" \
  --workers 3

# Step 5: Wait for cluster to be ready
echo "⏳ Waiting for the cluster to become active..."
until ibmcloud oc cluster get --cluster "$CLUSTER_NAME" --json | jq -r '.state' | grep -qE 'normal|active'; do
  echo -n "."
  sleep 30
done
echo "✅ Cluster is active!"

# Step 6: Apply tags
echo "🏷️ Applying tags..."
CLUSTER_CRN=$(ibmcloud oc cluster get --cluster "$CLUSTER_NAME" --json | jq -r '.crn')
ibmcloud resource tag-attach --resource-id "$CLUSTER_CRN" --tag-names "$TAGS"
echo "✅ Tags applied: $TAGS"

echo "🎉 Cluster '$CLUSTER_NAME' is ready to use!"
