#!/bin/bash

export OC_URL=https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-client-linux.tar.gz
export OI_URL=https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-install-linux.tar.gz

export PATH=$WORKSPACE:$PATH

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

OSD_VERSION=4.16.16
SERVICE_ACCOUNT_FILE=temp

# OSD_VERSION=${OSD_VERSION:-$(ocm list versions | tail -n1)}
echo "creating OSD_VERSION : $OSD_VERSION"


ocm create cluster --ccs --provider gcp --region us-east1 --service-account-file  $SERVICE_ACCOUNT_FILE --subscription-type marketplace-gcp --marketplace-gcp-terms  --version "$OSD_VERSION" "$CLUSTER_NAME"
CLUSTER_ID=$(ocm list clusters --columns "id,name" | grep $CLUSTER_NAME| cut -d " " -f1)

echo "CLUSTER_ID : $CLUSTER_ID"

echo $CLUSTER_ID > $WORKSPACE/cluster-info.id

if [[ -z "$CLUSTER_ID" ]]; then
    echo "Cluster $CLUSTER_NAME not found...";
    exit 0;
fi

while [[ -z $(ocm cluster status $CLUSTER_ID | grep "State:.*ready") ]]; do
    echo "Waiting for cluster $CLUSTER_ID to get ready...";
    sleep 30;
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

echo
cat $CLUSTER_CONFIG
echo

export KUBECONFIG=$WORKSPACE/kubeconfig
rm -rvf $KUBECONFIG
retries=50
until [[ $retries == 0 ]]; do
    echo "Attempting to login to get kubeconfig - $retries attempts remaining..."
    oc login $(ocm describe cluster $CLUSTER_ID --json | jq -rc '.api.url') --username $KUBEADMIN_USER --password $KUBEADMIN_PASSWORD >/dev/null 2>&1 && break
    sleep 30
    retries=$(($retries - 1))
done
if [[ $retries == 0 ]]; then
    echo "Unable to login as $KUBEADMIN_USER!"
else
    echo "Successfull logged in as $KUBEADMIN_USER"
fi
ocm describe cluster $CLUSTER_NAME > $WORKSPACE/cluster-info.yaml
