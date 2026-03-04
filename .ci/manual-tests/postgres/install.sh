#!/bin/sh

set -e
set -x

HELM_IMAGE_NAME=backstage
HELM_REPO_NAME=rhdh-chart
# shellcheck disable=SC2034
HELM_REPO_URL="https://redhat-developer.github.io/rhdh-chart"
K8S_CLUSTER_URL=
RELEASE_NAME=rhdh
NAME_SPACE=external-postgres
OCM_CLUSTER_TOKEN=

oc login --token="${OCM_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}"
oc delete namespace "${NAME_SPACE}"
oc create namespace "${NAME_SPACE}"
oc config set-context --current --namespace="${NAME_SPACE}"
K8S_CLUSTER_ROUTER_BASE=$(oc get ingresses.config/cluster -o jsonpath='{.spec.domain}')

oc apply -f "./postgres-crt-secrets.yaml"
oc apply -f "./postgress-cred-secret.yaml"
helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" -f "./values.yaml" --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" --set upstream.backstage.image.tag="next"
