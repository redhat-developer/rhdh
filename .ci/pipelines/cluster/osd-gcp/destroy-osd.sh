#!/bin/bash
set -e

CLUSTER_NAME=${CLUSTER_NAME:-osdgcp}

ocm login --client-id=$CLIENT_ID --client-secret=$CLIENT_SECRET

echo "Logged in as $(ocm whoami | jq -rc '.username')"

echo "Looking for clusters that matches '$CLUSTER_NAME'"
CLUSTER_ID=$(ocm list clusters | awk -v name="$CLUSTER_NAME" '$2 == name {print $1}')

ocm describe cluster $CLUSTER_ID

ocm delete /api/clusters_mgmt/v1/clusters/$CLUSTER_ID

# while [[ -z $(ocm cluster status $CLUSTER_ID 2>&1 | grep "not found") ]]; do
#     echo "Waiting for cluster $CLUSTER_ID to be completely uninstalled...";
#     sleep 30;
# done
