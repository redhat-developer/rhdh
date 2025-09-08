#!/bin/bash

re_create_k8s_service_account_and_get_token() {
  local sa_namespace="default"
  local sa_name="tester-sa-2"
  local sa_binding_name="${sa_name}-binding"
  local sa_secret_name="${sa_name}-secret"
  local token
  if token="$(kubectl get secret ${sa_secret_name} -n ${sa_namespace} -o jsonpath='{.data.token}' 2>/dev/null)"; then
    K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
    echo "Acquired existing token for the service account into K8S_CLUSTER_TOKEN"
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
  fi
  K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
  K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
  export K8S_CLUSTER_TOKEN K8S_CLUSTER_TOKEN_ENCODED K8S_SERVICE_ACCOUNT_TOKEN OCM_CLUSTER_TOKEN
}

patch_and_restart() {
  local namespace=$1
  local resource_type=$2
  local resource_name=$3
  local patch_file=$4

  echo "Waiting for $resource_type/$resource_name to be present..."
  kubectl wait --for=jsonpath='{.metadata.name}'="$resource_name" "$resource_type/$resource_name" -n "$namespace" --timeout=60s
  
  echo "Patching $resource_type/$resource_name in namespace $namespace with file $patch_file"
  kubectl patch "$resource_type" "$resource_name" -n "$namespace" --type=merge --patch-file "$patch_file"
  
  echo "Scaling down $resource_type/$resource_name to 0 replicas"
  kubectl scale "$resource_type" "$resource_name" --replicas=0 -n "$namespace"
  
  echo "Waiting for pods to terminate gracefully (timeout: 60s)..."
  if ! kubectl wait --for=delete pods -l app="$resource_name" -n "$namespace" --timeout=60s; then
    echo "Warning: Pods did not terminate gracefully within 60s"
    echo "Attempting force deletion of pods..."
    kubectl delete pods -l app="$resource_name" -n "$namespace" --force --grace-period=0
    # Wait a bit to ensure pods are actually gone
    sleep 5
  fi
  
  echo "Scaling up $resource_type/$resource_name to 1 replica"
  kubectl scale "$resource_type" "$resource_name" --replicas=1 -n "$namespace"
  
  echo "Patch and restart completed for $resource_type/$resource_name"
}
