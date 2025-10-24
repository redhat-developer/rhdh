#!/bin/bash
set -e

# Script para configurar GitOps (OpenShift GitOps/ArgoCD) para o Orchestrator

NAMESPACE="orchestrator-infra"
GITOPS_NAMESPACE="openshift-gitops"

echo "=== Installing OpenShift GitOps Operator ==="

# Instalar OpenShift GitOps Operator
cat << EOF | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: openshift-gitops-operator
  namespace: openshift-operators
spec:
  channel: latest
  installPlanApproval: Automatic
  name: openshift-gitops-operator
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF

echo "=== Waiting for GitOps Operator to be ready ==="
sleep 30

# Aguardar o operator estar pronto
until oc get deployment/cluster -n ${GITOPS_NAMESPACE} > /dev/null 2>&1; do
  echo "Waiting for GitOps deployment..."
  sleep 10
done

echo "=== Configuring ArgoCD for Orchestrator ==="

# Criar ArgoCD Application para o Orchestrator
cat << EOF | oc apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: orchestrator-infra
  namespace: ${GITOPS_NAMESPACE}
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/rhdh-orchestrator-test/orchestrator-gitops
    targetRevision: main
    path: environments/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: ${NAMESPACE}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
    - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
EOF

# Criar AppProject para o Orchestrator
cat << EOF | oc apply -f -
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: orchestrator
  namespace: ${GITOPS_NAMESPACE}
spec:
  description: Orchestrator Infrastructure Project
  sourceRepos:
    - 'https://github.com/rhdh-orchestrator-test/*'
    - 'https://github.com/parodos-dev/*'
  destinations:
    - namespace: ${NAMESPACE}
      server: https://kubernetes.default.svc
    - namespace: ${GITOPS_NAMESPACE}
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: '*'
      kind: '*'
  namespaceResourceWhitelist:
    - group: '*'
      kind: '*'
EOF

# Configurar RBAC para o GitOps acessar o namespace do Orchestrator
cat << EOF | oc apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gitops-orchestrator-admin
  namespace: ${NAMESPACE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: admin
subjects:
  - kind: ServiceAccount
    name: openshift-gitops-argocd-application-controller
    namespace: ${GITOPS_NAMESPACE}
  - kind: ServiceAccount
    name: openshift-gitops-argocd-server
    namespace: ${GITOPS_NAMESPACE}
EOF

# Criar ConfigMap com repositórios de workflows
cat << EOF | oc apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: orchestrator-gitops-config
  namespace: ${NAMESPACE}
data:
  repositories.yaml: |
    repositories:
      - name: orchestrator-workflows
        url: https://github.com/rhdh-orchestrator-test/serverless-workflows
        branch: main
        path: workflows
      - name: orchestrator-infrastructure
        url: https://github.com/rhdh-orchestrator-test/orchestrator-gitops
        branch: main
        path: infrastructure
      - name: orchestrator-templates
        url: https://github.com/parodos-dev/workflow-software-templates
        branch: main
        path: templates
EOF

# Configurar webhook para sincronização automática (opcional)
echo "=== Setting up GitOps webhooks (optional) ==="

# Obter a URL do ArgoCD
ARGO_ROUTE=$(oc get route openshift-gitops-server -n ${GITOPS_NAMESPACE} -o jsonpath='{.spec.host}')
echo "ArgoCD URL: https://${ARGO_ROUTE}"

# Criar secret para webhook (se necessário)
WEBHOOK_SECRET=$(openssl rand -hex 20)
cat << EOF | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: orchestrator-webhook-secret
  namespace: ${GITOPS_NAMESPACE}
type: Opaque
stringData:
  webhook.secret: ${WEBHOOK_SECRET}
EOF

echo "=== GitOps configuration completed ==="
echo ""
echo "GitOps Details:"
echo "  ArgoCD URL: https://${ARGO_ROUTE}"
echo "  Namespace: ${GITOPS_NAMESPACE}"
echo "  Orchestrator App: orchestrator-infra"
echo ""
echo "To access ArgoCD:"
echo "  Username: admin"
echo "  Password: $(oc get secret openshift-gitops-cluster -n ${GITOPS_NAMESPACE} -o jsonpath='{.data.admin\.password}' | base64 -d)"
echo ""
echo "Webhook Secret (for GitHub integration): ${WEBHOOK_SECRET}"
