#!/bin/bash

# Defaults
NAMESPACE="sonarqube"
VALUES_FILE="$(dirname "$0")/values.yaml"
EDITION="developer"
HOST=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --namespace) NAMESPACE="$2"; shift ;;
        --values) VALUES_FILE="$2"; shift ;;
        --edition) EDITION="$2"; shift ;;
        --host) HOST="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

# Create namespace if it doesn't exist
kubectl get namespace "$NAMESPACE" > /dev/null || kubectl create namespace "$NAMESPACE"

helm repo add sonarqube https://SonarSource.github.io/helm-chart-sonarqube --force-update
helm repo update

HELM_ARGS="--install -n ${NAMESPACE} sonarqube sonarqube/sonarqube"
HELM_ARGS="${HELM_ARGS} --set edition=${EDITION}"

if [ -f "${VALUES_FILE}" ]; then
    HELM_ARGS="${HELM_ARGS} -f ${VALUES_FILE}"
else
    echo "Warning: Values file not found at ${VALUES_FILE}"
fi

if [ -n "${HOST}" ]; then
    HELM_ARGS="${HELM_ARGS} --set OpenShift.route.host=${HOST}"
fi

HELM_ARGS="${HELM_ARGS} --set postgresql.image.repository=bitnami/postgresql"
HELM_ARGS="${HELM_ARGS} --set postgresql.image.tag=15.3.0"
# To use an external PostgreSQL, uncomment the following line
# HELM_ARGS="${HELM_ARGS} --set postgresql.enabled=false"

# shellcheck disable=SC2086
helm upgrade ${HELM_ARGS}
