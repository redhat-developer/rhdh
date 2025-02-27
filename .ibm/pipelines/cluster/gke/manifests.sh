#!/bin/bash

apply_gke_frontend_config() {
  echo "Applying GKE Frontend Config"
  kubectl apply -f "${DIR}/cluster/gke/manifest/frontend-config.yaml" 
}

apply_gke_operator_ingress() {
  local service_name=$1
  echo "Applying GKE Ingress"
  export SERVICE_NAME=$service_name
  envsubst < "${DIR}/cluster/gke/manifest/gke-operator-ingress.yaml" | kubectl apply -f -
}