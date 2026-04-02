#!/bin/bash
set -e

WORKSPACE=$(pwd)/osdcluster
mkdir -p $WORKSPACE
export PATH=$WORKSPACE:$PATH

CLIENT_ID="${CLIENT_ID:-$(cat /tmp/osdsecrets/OSD_CLIENT_ID)}"
CLIENT_SECRET="${CLIENT_SECRET:-$(cat /tmp/osdsecrets/OSD_CLIENT_SECRET)}"
SERVICE_ACCOUNT_FILE="${SERVICE_ACCOUNT_FILE:-$(cat /tmp/osdsecrets/SERVICE_ACCOUNT_FILE)}"
OSD_VERSION="${OSD_VERSION:-4.17.12}"

if [ -n "$CLUSTER_NAME" ]; then
  echo $CLUSTER_NAME > $WORKSPACE/cluster-info.name
fi

if [ -f $WORKSPACE/cluster-info.name ]; then
  CLUSTER_NAME="$(cat $WORKSPACE/cluster-info.name)"
else
  CLUSTER_NAME="osdgcp-$(date +%m%d)"
  echo $CLUSTER_NAME > $WORKSPACE/cluster-info.name
fi

echo "Working with cluster '$CLUSTER_NAME'"

ocm login --client-id=$CLIENT_ID --client-secret=$CLIENT_SECRET

echo "Logged in as $(ocm whoami | jq -rc '.username')"

echo $SERVICE_ACCOUNT_FILE > $WORKSPACE/gcp_service_account_json.json
SERVICE_ACCOUNT_FILE=$WORKSPACE/gcp_service_account_json.json

# OSD_VERSION=${OSD_VERSION:-$(ocm list versions | tail -n1)}
echo "creating OSD_VERSION : $OSD_VERSION"

ocm create cluster --ccs --provider gcp --region us-west1 --service-account-file $SERVICE_ACCOUNT_FILE --subscription-type marketplace-gcp --marketplace-gcp-terms --version "$OSD_VERSION" "$CLUSTER_NAME"
CLUSTER_ID=$(ocm list clusters --columns "id,name" | grep $CLUSTER_NAME | cut -d " " -f1)

echo "CLUSTER_ID : $CLUSTER_ID"

echo $CLUSTER_ID > $WORKSPACE/cluster-info.id

if [[ -z "$CLUSTER_ID" ]]; then
  echo "Cluster $CLUSTER_NAME not found..."
  exit 0
fi

while [[ -z $(ocm cluster status $CLUSTER_ID | grep "State:.*ready") ]]; do
  echo "Waiting for cluster $CLUSTER_ID to get ready..."
  sleep 30
done

echo "Creating kubeadmin user"
KUBEADMIN_USER=kubeadmin
KUBEADMIN_PASSWORD=$(dd if=/dev/random count=1 2>&1 | sha1sum | base64)
ocm create idp --type htpasswd -c $CLUSTER_ID -n 'kubeadmin' --username $KUBEADMIN_USER --password $KUBEADMIN_PASSWORD
ocm create user $KUBEADMIN_USER -c $CLUSTER_ID --group cluster-admins

CLUSTER_CONFIG=$WORKSPACE/cluster-config.yaml
echo "Cluster $CLUSTER_ID is ready"
echo "    console: $(ocm describe cluster $CLUSTER_ID --json | jq -rc '.console.url')" > $CLUSTER_CONFIG
echo "    api_url: $(ocm describe cluster $CLUSTER_ID --json | jq -rc '.api.url')" >> $CLUSTER_CONFIG
echo "    $KUBEADMIN_USER: $KUBEADMIN_PASSWORD" >> $CLUSTER_CONFIG
echo "    cli: oc login $(ocm describe cluster $CLUSTER_ID --json | jq -rc '.api.url') --username $KUBEADMIN_USER --password $KUBEADMIN_PASSWORD" >> $CLUSTER_CONFIG

export KUBECONFIG=$WORKSPACE/kubeconfig
rm -rvf $KUBECONFIG
CLUSTER_API_URL=$(ocm describe cluster $CLUSTER_ID --json | jq -rc '.api.url')
for i in {1..50}; do
  echo "Attempt $i: Logging in..."
  if oc login "$CLUSTER_API_URL" --username "$KUBEADMIN_USER" --password "$KUBEADMIN_PASSWORD" --insecure-skip-tls-verify=true; then
    echo "Login successful!"
    ocm describe cluster $CLUSTER_ID > $WORKSPACE/cluster-info.yaml
    exit 0
  fi
  echo "Login failed. Retrying in 30 seconds..."
  sleep 30
done

echo "Exceeded maximum retries. Login failed."
exit 1
