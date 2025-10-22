#!/bin/bash
set -e

# Script para deploy do Keycloak para autenticação

NAMESPACE="orchestrator-infra"
KEYCLOAK_ADMIN_USER="admin"
KEYCLOAK_ADMIN_PASSWORD="admin123"

echo "=== Deploying Keycloak for Orchestrator ==="

# Criar namespace se não existir
oc create namespace ${NAMESPACE} --dry-run=client -o yaml | oc apply -f -

# Criar secret do Keycloak
cat <<EOF | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: keycloak-admin-secret
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  username: ${KEYCLOAK_ADMIN_USER}
  password: ${KEYCLOAK_ADMIN_PASSWORD}
EOF

# Deploy do Keycloak
cat <<EOF | oc apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keycloak
  namespace: ${NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: keycloak
  template:
    metadata:
      labels:
        app: keycloak
    spec:
      containers:
      - name: keycloak
        image: quay.io/keycloak/keycloak:22.0
        args:
          - start-dev
        env:
        - name: KEYCLOAK_ADMIN
          valueFrom:
            secretKeyRef:
              name: keycloak-admin-secret
              key: username
        - name: KEYCLOAK_ADMIN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: keycloak-admin-secret
              key: password
        - name: KC_DB
          value: postgres
        - name: KC_DB_URL
          value: jdbc:postgresql://postgresql:5432/keycloak
        - name: KC_DB_USERNAME
          value: keycloak
        - name: KC_DB_PASSWORD
          value: keycloak
        - name: KC_PROXY
          value: edge
        - name: KC_HOSTNAME_STRICT
          value: "false"
        - name: KC_HTTP_ENABLED
          value: "true"
        ports:
        - containerPort: 8080
          name: http
        - containerPort: 8443
          name: https
        readinessProbe:
          httpGet:
            path: /realms/master
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /realms/master
            port: 8080
          initialDelaySeconds: 45
          periodSeconds: 20
EOF

# Criar Service
cat <<EOF | oc apply -f -
apiVersion: v1
kind: Service
metadata:
  name: keycloak
  namespace: ${NAMESPACE}
spec:
  selector:
    app: keycloak
  ports:
  - name: http
    port: 8080
    targetPort: 8080
  - name: https
    port: 8443
    targetPort: 8443
  type: ClusterIP
EOF

# Criar Route
cat <<EOF | oc apply -f -
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: keycloak
  namespace: ${NAMESPACE}
spec:
  tls:
    termination: edge
  to:
    kind: Service
    name: keycloak
    weight: 100
  port:
    targetPort: http
EOF

echo "=== Waiting for Keycloak to be ready ==="
oc wait deployment keycloak -n ${NAMESPACE} --for=condition=Available --timeout=300s

KEYCLOAK_URL=$(oc get route keycloak -n ${NAMESPACE} -o jsonpath='{.spec.host}')
echo "Keycloak available at: https://${KEYCLOAK_URL}"
echo "Admin credentials: ${KEYCLOAK_ADMIN_USER} / ${KEYCLOAK_ADMIN_PASSWORD}"

# Configurar realm para o Orchestrator
echo "=== Configuring Orchestrator realm ==="
sleep 10

# Criar ConfigMap com a configuração do realm
cat <<'EOF' | oc apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: keycloak-orchestrator-realm
  namespace: orchestrator-infra
data:
  realm-config.json: |
    {
      "realm": "orchestrator",
      "enabled": true,
      "sslRequired": "external",
      "clients": [
        {
          "clientId": "orchestrator",
          "enabled": true,
          "publicClient": false,
          "secret": "orchestrator-secret",
          "redirectUris": [
            "http://localhost:*",
            "https://*.openshiftapps.com/*"
          ],
          "webOrigins": ["+"],
          "directAccessGrantsEnabled": true,
          "standardFlowEnabled": true
        }
      ],
      "users": [
        {
          "username": "orchestrator-user",
          "enabled": true,
          "firstName": "Orchestrator",
          "lastName": "User",
          "email": "user@orchestrator.com",
          "credentials": [
            {
              "type": "password",
              "value": "password",
              "temporary": false
            }
          ],
          "realmRoles": ["user"]
        }
      ]
    }
EOF

echo "=== Keycloak deployment completed ==="