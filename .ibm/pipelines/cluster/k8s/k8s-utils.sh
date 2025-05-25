#!/bin/bash

re_create_k8s_service_account_and_get_token() {
  local sa_namespace="default"
  local sa_name="tester-sa-2"
  local sa_binding_name="${sa_name}-binding"
  local sa_secret_name="${sa_name}-secret"
  local token
  if token="$(oc get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"; then
    K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
    echo "Acquired existing token for the service account into K8S_CLUSTER_TOKEN"
  else
    echo "Creating service account"
    if ! oc get serviceaccount ${sa_name} -n ${sa_namespace} &> /dev/null; then
      echo "Creating service account ${sa_name}..."
      oc create serviceaccount ${sa_name} -n ${sa_namespace}
      echo "Creating cluster role binding..."
      oc create clusterrolebinding ${sa_binding_name} \
          --clusterrole=cluster-admin \
          --serviceaccount=${sa_namespace}:${sa_name}
      echo "Service account and binding created successfully"
    else
      echo "Service account ${sa_name} already exists in namespace ${sa_namespace}"
    fi
    echo "Creating secret for service account"
    oc apply --namespace="${sa_namespace}" -f - <<EOF
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
    token="$(oc get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"
    K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
    echo "Acquired token for the service account into K8S_CLUSTER_TOKEN"
  fi
  K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
  K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  export K8S_CLUSTER_TOKEN K8S_CLUSTER_TOKEN_ENCODED K8S_SERVICE_ACCOUNT_TOKEN OCM_CLUSTER_TOKEN
}
