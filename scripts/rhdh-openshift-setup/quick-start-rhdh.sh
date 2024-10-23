#!/bin/sh

# Defaults to the https://github.com/redhat-developer/rhdh-chart helm chart
HELM_REPO_NAME=rhdh-chart
HELM_REPO_URL=https://redhat-developer.github.io/rhdh-chart
DEFAULT_VALUES_FILE="${PWD}/values.yaml"
HELM_CHART_NAME=backstage

usage() {
  echo "
This script simplifies and automates the installation process of Helm charts on OpenShift Container Platform (OCP) clusters.
User should be logged into a cluster to use this script. This allows you to deploy resources into openshift for usage with backstage plugins that require kubernetes resources. Please provide your secret file in the form of 'rhdh-secrets.local.yaml' in the auth directory.

Usage:
  $0 [OPTIONS]

Options:
  -n, --namespace <namespace>           : Specify the namespace for the Helm release. Default: 'rhdh'
      --router-base <router-base>       : Manually provide the cluster router base for the helm deployment to use. Autodetects if not provided.
      --release-name <name>             : Specify a custom release name for the Helm chart. Auto-generates if not provided, which will always generate a new helm release instead of upgrading an existing one.
      --values <file>                   : Specify your own values file for the Helm chart. Default: 'values.yaml' in the script's current directory.
      --uninstall <option>              : Uninstall the Helm chart and/or Kubernetes resources.
                                          Options:
                                            - all: Uninstall the Helm chart, and all Kubernetes resources.
                                            - helm: Uninstall the Helm chart.
                                            - configs: Uninstall the configmaps and secrets resources.
                                            - kubernetes: Uninstall all Kubernetes resources.
      --kubernetes-resources <options>  : Deploy Kubernetes resources.
                                          Options:
                                            - serviceaccount: Deploy service account resources and updates secrets with service account token
                                            - topology-resources: Deploy resources for testing Topology and Tekton plugin.
                                            - all: Deploy all Kubernetes resources.
      --helm-repo-url <url>             : Specify the URL of the Helm repository to install. Default: https://redhat-developer.github.io/rhdh-chart
      --helm-repo-name <name>           : Specify the name of the Helm repository to install and use. Default: rhdh-chart
      --helm-chart-name <name>          : Specify the name of the Helm chart in the helm repository. Default: backstage
  -h, --help                            : Show this help message and exit.

Examples:
  $0                                       # Auto-detects router base and installs the default Helm chart with an autogenerated release name
  $0 --router-base example.com             # Manually specifies the router base and installs the Helm chart
  $0 --release-name myrelease              # Installs the default Helm chart with the specified release name
  $0 --generate-name                       # Generates a name for the Helm release
  $0 --values /path/to/values.yaml         # Installs the Helm chart using the specified values file
  $0 --uninstall all                       # Uninstalls the Helm chart and all Kubernetes resources
  $0 --helm-repo-url https://charts.openshift.io/ --helm-repo-name redhat-developer-hub --helm-chart-name openshift-helm-charts # Installs the specified Helm chart from the specified repository
  $0 --kubernetes-resources serviceaccount # Deploys service account resources and updates secrets with service account token
"
}

add_helm_repo() {
  helm version

  # Check if the repository already exists
  if ! helm repo list | grep -q "^${HELM_REPO_NAME}"; then
    helm repo add "${HELM_REPO_NAME}" "${HELM_REPO_URL}"
  else
    echo "Repository ${HELM_REPO_NAME} already exists - updating repository instead."
    helm repo update
  fi
}

# PREREQ #0: install oc, helm if you don't have them installed
install_oc() {
  if [[ -x "$(command -v oc)" ]]; then
    echo "oc is already installed."
  else
    curl -LO https://mirror.openshift.com/pub/openshift-v4/clients/oc/latest/linux/oc.tar.gz
    tar -xf oc.tar.gz
    mv oc /usr/local/bin/
    rm oc.tar.gz
    echo "oc installed successfully."
  fi
}

install_helm_release() {
  if [[ -x "$(command -v helm)" ]]; then
    echo "Helm is already installed."
  else
    echo "Installing Helm 3 client"
    WORKING_DIR=$(pwd)
    mkdir ~/tmpbin && cd ~/tmpbin

    HELM_INSTALL_DIR=$(pwd)
    curl -sL https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash -f
    export PATH=${HELM_INSTALL_DIR}:$PATH

    cd $WORKING_DIR
    echo "helm client installed successfully."
  fi
}
uninstall_helm(){
  if [ -z "${RELEASE_NAME}" ]; then
    echo "Please provide the helm release name to uninstall the helm chart."
    helm list --namespace "${NAMESPACE}"
    exit 1
  fi
  helm uninstall ${RELEASE_NAME} -n ${NAMESPACE}
  echo "Please delete any persistent volume claims that were created by the helm chart for a full uninstall."
  echo "Otherwise, leave them be and the next install with the same helm release name will reuse them."
}
uninstall_kubernetes_resources() {
  # Deployments
  oc delete deployment backstage-app --namespace=${NAMESPACE}

  # Pipelines to test Tekton plugin
  oc delete pipeline hello-world-pipeline --namespace=${NAMESPACE}
  oc delete pipelinerun hello-world-pipeline-run --namespace=${NAMESPACE}

  # Cluster Service Account
  oc delete serviceaccount rhdh-k8s-plugin --namespace=${NAMESPACE}
  oc delete secret rhdh-k8s-plugin-secret --namespace=${NAMESPACE}

  # ClusterRoles and ClusterRoleBindings
  oc delete clusterrole rhdh-k8s-plugin --namespace=${NAMESPACE}
  oc delete clusterrole rhdh-k8s-plugin-ocm --namespace=${NAMESPACE}
  oc delete clusterrolebinding rhdh-k8s-plugin
  oc delete clusterrolebinding rhdh-k8s-plugin-ocm

  # Pipelines to test Tekton plugin
  oc apply -f $PWD/resources/pipelines/hello-world-pipeline.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/pipelines/hello-world-pipeline-run.yaml --namespace=${NAMESPACE}

  # Upload Jobs and Cronjobs
  oc delete cronjob say-hello --namespace=${NAMESPACE}
  oc delete job print-pi --namespace=${NAMESPACE}

  # Daemon Set
  oc delete daemonset test-daemonset --namespace=${NAMESPACE}

  # Stateful Set along with it's corresponding service resource
  oc delete statefulset example-statefulset --namespace=${NAMESPACE}
  oc delete service example-service --namespace=${NAMESPACE}
}
uninstall_configs() {
  # ConfigMaps and Secrets
  oc delete configmap app-config-rhdh --namespace=${NAMESPACE}
  oc delete secret rhdh-secrets --namespace=${NAMESPACE}
  oc delete configmap rbac-policy --namespace=${NAMESPACE}
}

deploy_serviceaccount_resources() {
  # Change the namespace of the resources to the one namespace set above
  sed -i "s/namespace:.*/namespace: ${NAMESPACE}/g" ${PWD}/resources/service-account-rhdh.yaml
  sed -i "s/namespace:.*/namespace: ${NAMESPACE}/g" ${PWD}/resources/cluster-roles/cluster-role-binding-k8s.yaml
  sed -i "s/namespace:.*/namespace: ${NAMESPACE}/g" ${PWD}/resources/cluster-roles/cluster-role-binding-ocm.yaml

  # Cluster Service Account
  oc apply -f $PWD/resources/service-account-rhdh.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/auth/service-account-rhdh-secret.yaml --namespace=${NAMESPACE}

  # ClusterRoles and ClusterRoleBindings
  oc apply -f $PWD/resources/cluster-roles/cluster-role-k8s.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/cluster-roles/cluster-role-binding-k8s.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/cluster-roles/cluster-role-ocm.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/cluster-roles/cluster-role-binding-ocm.yaml --namespace=${NAMESPACE}

  # Obtain the service account access token and add it to secrets-rhdh-secrets.yaml as K8S_CLUSTER_TOKEN
  # Needs K8S_CLUSTER_TOKEN field to exist in the secrets file
  oc get secret rhdh-k8s-plugin-secret --namespace=${NAMESPACE} -o yaml > $PWD/auth/service-account-rhdh-token.local.yaml
  TOKEN=$(grep 'token:' $PWD/auth/service-account-rhdh-token.yaml | awk '{print $2}')

  sed -i "s/K8S_CLUSTER_TOKEN:.*/K8S_CLUSTER_TOKEN: $TOKEN/g" $PWD/auth/rhdh-secrets.local.yaml
}
deploy_topology_tekton_resources() {
  # Pipelines to test Tekton plugin
  oc apply -f $PWD/resources/pipelines/hello-world-pipeline.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/pipelines/hello-world-pipeline-run.yaml --namespace=${NAMESPACE}

  # Upload Jobs and Cronjobs
  oc apply -f $PWD/resources/jobs/cron-job.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/jobs/pi-job.yaml --namespace=${NAMESPACE}

  # Upload Daemon Set
  oc apply -f $PWD/resources/daemon-sets/daemon-set.yaml --namespace=${NAMESPACE}

  # # Upload Deployment
  oc apply -f $PWD/resources/deployments/backstage-test.yaml --namespace=${NAMESPACE}

  # Upload Stateful Set along with it's corresponding service resource
  oc apply -f $PWD/resources/stateful-sets/stateful-set.yaml --namespace=${NAMESPACE}
}

apply_configs(){
  # RBAC policies
  oc apply -f $PWD/resources/rbac-policies.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/auth/rhdh-secrets.local.yaml --namespace=${NAMESPACE}
  oc apply -f $PWD/resources/rhdh-configmap.yaml --namespace=${NAMESPACE}
}
# Parse command-line arguments
ROUTER_BASE=""
RELEASE_NAME=""
NAMESPACE="rhdh"
VALUES_FILE="${DEFAULT_VALUES_FILE}"
KUBERNETES_RESOURCES=""
EXTRA_HELM_ARGS=""
UNINSTALL=""
HELM_CMD=""

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --uninstall)
      UNINSTALL="$2"
      ;;
    --router-base)
      ROUTER_BASE="$2"
      shift
      ;;
    --release-name)
      RELEASE_NAME="$2"
      shift
      ;;
    --namespace | -n)
      NAMESPACE="$2"
      shift
      ;;
    --kubernetes-resources)
      KUBERNETES_RESOURCES="$2"
      ;;
    --values)
      VALUES_FILE="$2"
      shift
      ;;
    --helm-repo-url)
      HELM_REPO_URL="$2"
      shift
      ;;
    --helm-repo-name)
      HELM_REPO_NAME="$2"
      shift
      ;;
    --helm-chart-name)
      HELM_CHART_NAME="$2"
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      EXTRA_HELM_ARGS+=" $1"
      ;;
  esac
  shift
done

# Check for a specific argument to call the function
if [ -n "${UNINSTALL}" ]; then
  case "${UNINSTALL}" in
    all)
      uninstall_helm
      uninstall_configs
      uninstall_kubernetes_resources
      ;;
    configs)
      uninstall_configs
      ;;
    kubernetes)
      uninstall_kubernetes_resources
      ;;
    helm)
      uninstall_helm
      ;;
    *)
      echo "Invalid argument for --uninstall. Use 'all', 'helm', 'configs', or 'kubernetes'."
      exit 1
      ;;
  esac
  exit 0
fi

# Function to detect cluster router base
detect_cluster_router_base() {
  ROUTER_BASE=$(oc get ingress.config.openshift.io/cluster -o=jsonpath='{.spec.domain}')
}

# Detect cluster router base if not provided
if [[ -z "$ROUTER_BASE" ]]; then
  detect_cluster_router_base ]
    if [ $? -eq 0 ]; then
      echo "Cluster router base detected: ${ROUTER_BASE}"
    else
      echo "Error: Cluster router base could not be automatically detected. This is most likely due to lack of permissions."
      echo "Using default value in the 'values.yaml' file. Please provide it using the --router-base flag if you want a different router base."
    fi
fi

# Set cluster router base if provided or detected
if [[ -n "$ROUTER_BASE" ]]; then
  EXTRA_HELM_ARGS+=" --set global.clusterRouterBase=$ROUTER_BASE"
fi

if [[ -z "${RELEASE_NAME}" ]]; then
  HELM_CMD="helm install --generate-name"
else
  HELM_CMD="helm upgrade -i ${RELEASE_NAME}"
fi

PWD="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "$PWD"

# Create Namespace and switch to it
oc new-project ${NAMESPACE}
if [ $? -ne 0 ]; then
  # Switch to it if it already exists
  oc project ${NAMESPACE}
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "$DIR"

add_helm_repo

# Deploy Kubernetes resources
if [ -n "${KUBERNETES_RESOURCES}" ]; then
  # Maybe I can use a kustomize file to apply this instead of applying each resource individually
  case "${KUBERNETES_RESOURCES}" in
    serviceaccount)
      deploy_serviceaccount_resources
      ;;
    topology-resources)
      deploy_topology_tekton_resources
      ;;
    all)
      deploy_serviceaccount_resources
      deploy_topology_tekton_resources
      ;;
    *)
      echo "Invalid input for kubernetes resources, please provide either 'serviceaccount', 'topology-tekton-resources', or 'all'"
      exit 1
    ;;
  esac
fi

apply_configs

HELM_CMD+=" ${HELM_REPO_NAME}/${HELM_CHART_NAME} --namespace ${NAMESPACE} -f ${VALUES_FILE} ${EXTRA_HELM_ARGS}"

# Execute Helm install or upgrade command
echo "Executing: ${HELM_CMD}"

if eval "${HELM_CMD}"; then
  echo "Helm installation completed successfully."
else
  echo "Something went wrong with Helm installation!"
  helm list --namespace "${NAMESPACE}"
  exit 1
fi
