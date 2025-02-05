#!/bin/bash

handle_gke() {
  echo "Starting GKE deployment"
  for file in ${DIR}/cluster/gke/*.sh; do source $file; done

  K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  NAME_SPACE_K8S="showcase-k8s-ci-nightly"
  NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"
  export K8S_CLUSTER_ROUTER_BASE NAME_SPACE_K8S NAME_SPACE_RBAC_K8S

  gcloud_auth "${GKE_SERVICE_ACCOUNT_NAME}" "/tmp/secrets/GKE_SERVICE_ACCOUNT_KEY"
  gcloud_gke_get_credentials "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GOOGLE_CLOUD_PROJECT}"

  K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
  K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
  export K8S_CLUSTER_URL K8S_CLUSTER_API_SERVER_URL OCM_CLUSTER_URL

  re_create_k8s_service_account_and_get_token # Populate K8S_CLUSTER_TOKEN
  K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
  K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  export K8S_CLUSTER_TOKEN K8S_CLUSTER_TOKEN_ENCODED K8S_SERVICE_ACCOUNT_TOKEN OCM_CLUSTER_TOKEN

  local url="https://${K8S_CLUSTER_ROUTER_BASE}"
  initiate_gke_deployment
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}" "${url}" 50 30
  delete_namespace "${NAME_SPACE_K8S}"

  local rbac_rhdh_base_url="https://${K8S_CLUSTER_ROUTER_BASE}"
  initiate_rbac_gke_deployment
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}" "${rbac_rhdh_base_url}" 50 30
  delete_namespace "${NAME_SPACE_RBAC_K8S}"
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
    return 0
  fi
}

cleanup_gke() {
  delete_tekton_pipelines
}
