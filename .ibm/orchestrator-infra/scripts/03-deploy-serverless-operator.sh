#!/bin/bash
set -e

# Script para deploy do Serverless Logic Operator e SonataFlow Platform

NAMESPACE="orchestrator-infra"
OPERATOR_NAMESPACE="openshift-serverless-logic"

echo "=== Installing Serverless Logic Operator ==="

# Criar namespace do operator
oc create namespace ${OPERATOR_NAMESPACE} --dry-run=client -o yaml | oc apply -f -

# Criar Subscription do Serverless Logic Operator
cat <<EOF | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: logic-operator-rhel8
  namespace: ${OPERATOR_NAMESPACE}
spec:
  channel: latest
  name: logic-operator-rhel8
  source: redhat-operators
  sourceNamespace: openshift-marketplace
  installPlanApproval: Automatic
EOF

# Aguardar o operator estar pronto
echo "=== Waiting for Serverless Logic Operator to be ready ==="
sleep 30
oc wait csv -n ${OPERATOR_NAMESPACE} \
  -l operators.coreos.com/logic-operator-rhel8.${OPERATOR_NAMESPACE} \
  --for=jsonpath='{.status.phase}'=Succeeded \
  --timeout=300s || echo "Operator may already be ready"

# Verificar se o CRD foi criado
echo "=== Verifying SonataFlowPlatform CRD ==="
until oc get crd sonataflowplatforms.sonataflow.org > /dev/null 2>&1; do
  echo "Waiting for SonataFlowPlatform CRD..."
  sleep 5
done

echo "=== Creating SonataFlowPlatform for Orchestrator ==="

# Criar SonataFlowPlatform no namespace do orchestrator
cat <<EOF | oc apply -f -
apiVersion: sonataflow.org/v1alpha08
kind: SonataFlowPlatform
metadata:
  name: sonataflow-platform
  namespace: ${NAMESPACE}
spec:
  build:
    template:
      buildArgs:
        - name: QUARKUS_EXTENSION
          value: |
            org.kie:kie-addons-quarkus-jobs-knative-eventing:999-SNAPSHOT
            org.kie:kie-addons-quarkus-persistence-jdbc:999-SNAPSHOT
            io.quarkus:quarkus-jdbc-postgresql:3.8.6
            io.quarkus:quarkus-agroal:3.8.6
            org.kie:kie-addons-quarkus-source-files:999-SNAPSHOT
    config:
      strategyOptions:
        KanikoBuildCacheEnabled: "true"
  services:
    dataIndex:
      enabled: true
      persistence:
        postgresql:
          secretRef:
            name: sonataflow-psql-secret
            userKey: username
            passwordKey: password
          serviceRef:
            name: postgresql
            namespace: ${NAMESPACE}
            port: 5432
            databaseName: backstage_plugin_orchestrator
            databaseSchema: orchestrator
    jobService:
      enabled: true
      persistence:
        postgresql:
          secretRef:
            name: sonataflow-psql-secret
            userKey: username
            passwordKey: password
          serviceRef:
            name: postgresql
            namespace: ${NAMESPACE}
            port: 5432
            databaseName: backstage_plugin_orchestrator
            databaseSchema: orchestrator
EOF

# Criar secret para o SonataFlow acessar o PostgreSQL
cat <<EOF | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: sonataflow-psql-secret
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  username: orchestrator
  password: orchestrator123
EOF

echo "=== Waiting for SonataFlow services to be ready ==="
sleep 30

# Verificar se os serviços estão rodando
echo "Checking Data Index Service..."
kubectl get pods -n ${NAMESPACE} -l app=sonataflow-platform-data-index-service

echo "Checking Jobs Service..."
kubectl get pods -n ${NAMESPACE} -l app=sonataflow-platform-jobs-service

echo "=== SonataFlow Platform deployment completed ==="