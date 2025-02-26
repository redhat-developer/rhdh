#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gcloud.sh
source "$DIR"/cluster/gke/gcloud.sh
# shellcheck source=.ibm/pipelines/cluster/gke/gke-operator-deployment.sh
source "$DIR"/cluster/gke/gke-operator-deployment.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

handle_gke_operator() {
  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  export K8S_CLUSTER_ROUTER_BASE
  local url="https://${K8S_CLUSTER_ROUTER_BASE}"

  gcloud_auth "${GKE_SERVICE_ACCOUNT_NAME}" "/tmp/secrets/GKE_SERVICE_ACCOUNT_KEY"
  gcloud_gke_get_credentials "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GOOGLE_CLOUD_PROJECT}"
  gcloud_ssl_cert_create "$GKE_CERT_NAME" "$GKE_INSTANCE_DOMAIN_NAME" "$GOOGLE_CLOUD_PROJECT"

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL OCM_CLUSTER_URL

  re_create_k8s_service_account_and_get_token # Populate K8S_CLUSTER_TOKEN

  cluster_setup_k8s_operator

  prepare_operator

  initiate_gke_operator_deployment "${NAME_SPACE}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}" 50 30 20
  delete_namespace "${NAME_SPACE}"

  initiate_rbac_gke_operator_deployment "${NAME_SPACE_RBAC}" "https://${K8S_CLUSTER_ROUTER_BASE}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${url}" 50 30 20
  delete_namespace "${NAME_SPACE_RBAC}"
}

re_create_k8s_service_account_and_get_token() {
  local sa_namespace="default"
  local sa_name="tester-sa-2"
  local sa_binding_name="${sa_name}-binding"
  local sa_secret_name="${sa_name}-secret"
  local token
  if token="$(kubectl get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"; then
    K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
    echo "Acquired existing token for the service account into K8S_CLUSTER_TOKEN"
    return 0
  else
    echo "Creating service account"
    if ! kubectl get serviceaccount ${sa_name} -n ${sa_namespace} &> /dev/null; then
      echo "Creating service account ${sa_name}..."
      kubectl create serviceaccount ${sa_name} -n ${sa_namespace}
      echo "Creating cluster role binding..."
      kubectl create clusterrolebinding ${sa_binding_name} \
          --clusterrole=cluster-admin \
          --serviceaccount=${sa_namespace}:${sa_name}
      echo "Service account and binding created successfully"
    else
      echo "Service account ${sa_name} already exists in namespace ${sa_namespace}"
    fi
    echo "Creating secret for service account"
    kubectl apply --namespace="${sa_namespace}" -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${sa_secret_name}
  namespace: ${sa_namespace}
  annotations:
    kubernetes.io/service-account.name: ${sa_name}
type: kubernetes.io/service-account-token
EOF
    sleep 5
    token="$(kubectl get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"
    K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
    echo "Acquired token for the service account into K8S_CLUSTER_TOKEN"
    K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
    K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
    OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
    export K8S_CLUSTER_TOKEN K8S_CLUSTER_TOKEN_ENCODED K8S_SERVICE_ACCOUNT_TOKEN OCM_CLUSTER_TOKEN
    return 0
  fi
}

cleanup_gke() {
  delete_tekton_pipelines
  uninstall_olm
}
