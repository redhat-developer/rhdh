#!/bin/bash  -e
#
# Copyright (c) 2024 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# install a helm chart with the correct global.clusterRouterBase

# default namespace if none set
namespace="rhdh-helm"
chartrepo=0 # by default don't create a new chart repo unless the version chart version includes "CI" suffix
github=0 # by default don't use the Github repo unless the chart doesn't exist in the OCI registry

usage ()
{
  echo "Usage: $0 CHART_VERSION [-n namespace]

Examples:
  $0 1.1.1 
  $0 1.7-43-CI -n rhdh-ci

Options:
  -n, --namespace   Project or namespace into which to install specified chart; default: $namespace
      --github-repo If set will use the deprecated github repository to install the helm chart instead of the OCI registry.
  -r, --chartrepo   If set, a Helm Chart Repo will be applied to the cluster, based on the chart version.
                    If CHART_VERSION ends in CI and --github-repo is set, this is done by default.
"
  exit
}

if [[ $# -lt 1 ]]; then usage; fi

while [[ "$#" -gt 0 ]]; do
  case $1 in
    '-r'|'--chartrepo') chartrepo=1;;
    '-n'|'--namespace') namespace="$2"; shift 1;;
    '-h') usage;;
    '--github-repo') github=1;;
    *) CV="$1";;
  esac
  shift 1
done

if [[ ! $CV ]]; then usage; fi


tmpfile=/tmp/redhat-developer-hub.chart.values.yml
CHART_URL="oci://quay.io/rhdh/chart"

if ! helm show chart $CHART_URL --version $CV &> /dev/null; then github=1; fi
if [[ $github -eq 1 ]]; then
  # If a Github CI chart, create a chart repo
  if [[ $CV == *"-CI" ]]; then chartrepo=1; fi
  CHART_URL="https://github.com/rhdh-bot/openshift-helm-charts/raw/redhat-developer-hub-${CV}/charts/redhat/redhat/redhat-developer-hub/${CV}/redhat-developer-hub-${CV}.tgz"
fi

echo "Using ${CHART_URL} to install Helm chart"

# choose namespace for the install (or create if non-existant)
oc new-project "$namespace" || oc project "$namespace"

if [[ $chartrepo -eq 1 ]]; then
    oc apply -f https://github.com/rhdh-bot/openshift-helm-charts/raw/redhat-developer-hub-${CV}/installation/rhdh-next-ci-repo.yaml
fi

# 1. install (or upgrade)
helm upgrade redhat-developer-hub -i "${CHART_URL}" --version $CV

# 2. collect values
PASSWORD=$(kubectl get secret redhat-developer-hub-postgresql -o jsonpath="{.data.password}" | base64 -d)
CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')

# 3. change values
helm upgrade redhat-developer-hub -i "${CHART_URL}" --version $CV \
    --set global.clusterRouterBase="${CLUSTER_ROUTER_BASE}" \
    --set global.postgresql.auth.password="$PASSWORD"

# 4. cleanup
rm -f "$tmpfile"

echo "
Once deployed, Developer Hub $CV will be available at
https://redhat-developer-hub-${namespace}.${CLUSTER_ROUTER_BASE}
"
