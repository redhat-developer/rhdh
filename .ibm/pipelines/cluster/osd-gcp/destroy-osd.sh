#!/bin/bash

export OC_URL=https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-client-linux.tar.gz
export OI_URL=https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-install-linux.tar.gz

export PATH=$WORKSPACE:$PATH

CLUSTER_NAME=${CLUSTER_NAME:-osdgcp}

ocm login --client-id=$CLIENT_ID --client-secret=$CLIENT_SECRET

echo "Logged in as $(ocm whoami | jq -rc '.username')"

echo "Looking for clusters that matches '$CLUSTER_NAME'"
CLUSTERS=$(ocm list clusters --columns name --no-headers)
if [ -z $CLUSTERS ]; then
    echo "No cluster that matches '$CLUSTER_NAME' found"
    exit 0
fi
for c in $CLUSTERS; do
    if [[ $c =~ $CLUSTER_NAME ]]; then
        echo "Found $c - Requesting deletion..."
        ocm delete /api/clusters_mgmt/v1/clusters/$(ocm describe cluster $c --json | jq -rc .id)
    fi
done

CLUSTER_ID=$(ocm list clusters --columns "id,name" | grep $CLUSTER_NAME| cut -d " " -f1)
while [[ -z $(ocm cluster status $CLUSTER_ID 2>&1 | grep "not found") ]]; do
    echo "Waiting for cluster $CLUSTER_ID to be completely uninstalled...";
    sleep 30;
done
