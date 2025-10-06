#!/bin/bash

# Script to apply standard labels to existing GKE clusters
# Usage: ./apply-labels-manual.sh [CLUSTER_NAME] [LOCATION]

set -e

# === DEFAULT LABELS ===
readonly LABELS="app-code=rhdh-003,service-phase=dev,cost-center=726"
readonly PROJECT_ID="rhdh-qe"

# === FUNCTIONS ===

show_usage() {
  cat << EOF
Usage: $0 [CLUSTER_NAME] [LOCATION]

This script applies the following standard labels to GKE clusters:
  - app-code=rhdh-003
  - service-phase=dev  
  - cost-center=726

Arguments:
  CLUSTER_NAME     Name of the GKE cluster (optional)
  LOCATION         Zone or region of the cluster (optional)

If no arguments are provided, the script will list all available clusters
and allow you to select which cluster to label.

Examples:
  $0                                    # List clusters and allow selection
  $0 my-cluster us-central1-a          # Apply labels to specific cluster
  $0 my-cluster us-central1            # Apply labels to regional cluster

EOF
}

list_clusters() {
  echo ">>> Listing available clusters in project $PROJECT_ID..."
  gcloud container clusters list \
    --project="$PROJECT_ID" \
    --format="table(name,location,status)" \
    --quiet
}

apply_cluster_labels() {
  local cluster_name="$1"
  local location="$2"

  echo ">>> Applying labels to cluster: $cluster_name"
  echo ">>> Location: $location"
  echo ">>> Labels: $LABELS"

  # Determine if it's a zone or region
  if [[ "$location" =~ ^[a-z]+-[a-z]+[0-9]+$ ]]; then
    location_flag="--region"
  else
    location_flag="--zone"
  fi

  # Apply the labels
  gcloud container clusters update "$cluster_name" \
    "$location_flag" "$location" \
    --update-labels "$LABELS" \
    --project="$PROJECT_ID" \
    --quiet

  echo "✅ Labels successfully applied to cluster $cluster_name!"

  # Verify applied labels
  echo ">>> Verifying applied labels..."
  gcloud container clusters describe "$cluster_name" \
    "$location_flag" "$location" \
    --project="$PROJECT_ID" \
    --format="value(resourceLabels)" \
    --quiet
}

interactive_cluster_selection() {
  # List clusters
  list_clusters

  echo ""
  read -p "Enter cluster name: " cluster_name
  read -p "Enter location (zone or region): " location

  if [[ -z "$cluster_name" || -z "$location" ]]; then
    echo "❌ Error: Cluster name and location are required"
    exit 1
  fi

  apply_cluster_labels "$cluster_name" "$location"
}

apply_all_clusters() {
  echo ">>> Applying labels to ALL clusters in project $PROJECT_ID..."

  # Get cluster list in JSON format
  local clusters_json
  clusters_json=$(gcloud container clusters list \
    --project="$PROJECT_ID" \
    --format="json" \
    --quiet)

  if [[ "$clusters_json" == "[]" ]]; then
    echo "❌ No clusters found in project $PROJECT_ID"
    exit 1
  fi

  # Process each cluster
  echo "$clusters_json" | python3 -c "
import json
import sys
import subprocess

clusters = json.load(sys.stdin)
labels = '$LABELS'
project = '$PROJECT_ID'

for cluster in clusters:
    name = cluster['name']
    location = cluster['location']
    
    # Determine location flag
    if '-' in location and len(location.split('-')) == 3:
        location_flag = '--zone'
    else:
        location_flag = '--region'
    
    print(f'>>> Applying labels to cluster: {name} ({location})')
    
    try:
        cmd = [
            'gcloud', 'container', 'clusters', 'update', name,
            location_flag, location,
            '--update-labels', labels,
            '--project', project,
            '--quiet'
        ]
        subprocess.run(cmd, check=True)
        print(f'✅ Labels successfully applied to cluster {name}')
    except subprocess.CalledProcessError as e:
        print(f'❌ Error applying labels to cluster {name}: {e}')
"

  echo ">>> Complete! Verifying all clusters..."
  gcloud container clusters list \
    --project="$PROJECT_ID" \
    --format="table(name,location,resourceLabels)" \
    --quiet
}

# === MAIN SCRIPT ===

case "${1:-}" in
  -h | --help)
    show_usage
    exit 0
    ;;
  --all)
    apply_all_clusters
    exit 0
    ;;
  "")
    # Interactive mode
    interactive_cluster_selection
    ;;
  *)
    # Arguments provided
    if [[ -z "${2:-}" ]]; then
      echo "❌ Error: Location is required when cluster name is provided"
      show_usage
      exit 1
    fi
    apply_cluster_labels "$1" "$2"
    ;;
esac
