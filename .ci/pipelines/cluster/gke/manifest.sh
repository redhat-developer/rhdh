#!/bin/bash

apply_gke_frontend_config() {
  local namespace=$1
  echo "Applying GKE Frontend Config"
  kubectl apply -f "${DIR}/cluster/gke/manifest/frontend-config.yaml" --namespace="${namespace}"
}

apply_gke_operator_ingress() {
  local namespace=$1
  local service_name=$2
  echo "Applying GKE Ingress"
  export SERVICE_NAME=$service_name
  envsubst < "${DIR}/cluster/gke/manifest/gke-operator-ingress.yaml" | kubectl apply --namespace="${namespace}" -f -
}
