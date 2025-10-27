#!/bin/bash
set -e

# Script para deploy do PostgreSQL para o Orchestrator

NAMESPACE="orchestrator-infra"
PG_USER="postgres"
PG_PASSWORD="postgres123"
PG_DATABASE="orchestrator"

echo "=== Deploying PostgreSQL for Orchestrator ==="

# Criar namespace se não existir
oc create namespace ${NAMESPACE} --dry-run=client -o yaml | oc apply -f -

# Criar Secret do PostgreSQL
cat << EOF | oc apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: postgresql-secret
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  database-user: ${PG_USER}
  database-password: ${PG_PASSWORD}
  database-name: ${PG_DATABASE}
EOF

# Criar PersistentVolumeClaim
cat << EOF | oc apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgresql-pvc
  namespace: ${NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
EOF

# Deploy do PostgreSQL
cat << EOF | oc apply -f -
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgresql
  namespace: ${NAMESPACE}
spec:
  serviceName: postgresql
  replicas: 1
  selector:
    matchLabels:
      app: postgresql
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      containers:
      - name: postgresql
        image: registry.redhat.io/rhel9/postgresql-15:latest
        env:
        - name: POSTGRESQL_USER
          valueFrom:
            secretKeyRef:
              name: postgresql-secret
              key: database-user
        - name: POSTGRESQL_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgresql-secret
              key: database-password
        - name: POSTGRESQL_DATABASE
          valueFrom:
            secretKeyRef:
              name: postgresql-secret
              key: database-name
        - name: POSTGRESQL_MAX_CONNECTIONS
          value: "200"
        - name: POSTGRESQL_MAX_PREPARED_TRANSACTIONS
          value: "200"
        - name: POSTGRESQL_SHARED_BUFFERS
          value: "256MB"
        ports:
        - containerPort: 5432
          name: postgresql
        volumeMounts:
        - name: postgresql-data
          mountPath: /var/lib/pgsql/data
        livenessProbe:
          exec:
            command:
            - /usr/libexec/check-container
            - --live
          initialDelaySeconds: 120
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - /usr/libexec/check-container
          initialDelaySeconds: 5
          periodSeconds: 10
      volumes:
      - name: postgresql-data
        persistentVolumeClaim:
          claimName: postgresql-pvc
EOF

# Criar Service
cat << EOF | oc apply -f -
apiVersion: v1
kind: Service
metadata:
  name: postgresql
  namespace: ${NAMESPACE}
spec:
  selector:
    app: postgresql
  ports:
  - name: postgresql
    port: 5432
    targetPort: 5432
  type: ClusterIP
EOF

# Aguardar PostgreSQL ficar pronto
echo "=== Waiting for PostgreSQL to be ready ==="
oc wait statefulset postgresql -n ${NAMESPACE} --for=jsonpath='{.status.readyReplicas}'=1 --timeout=300s

# Criar databases para os componentes do Orchestrator
echo "=== Creating Orchestrator databases ==="
sleep 10

# Criar Job para inicializar os databases
cat << EOF | oc apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: init-orchestrator-db-$(date +%s)
  namespace: ${NAMESPACE}
  labels:
    app: init-orchestrator-db
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: init-db
        image: registry.redhat.io/rhel9/postgresql-15:latest
        env:
        - name: PGHOST
          value: postgresql
        - name: PGUSER
          valueFrom:
            secretKeyRef:
              name: postgresql-secret
              key: database-user
        - name: PGPASSWORD
          valueFrom:
            secretKeyRef:
              name: postgresql-secret
              key: database-password
        command:
        - /bin/bash
        - -c
        - |
          set -e
          echo "Creating Orchestrator databases..."
          
          # Databases para o Orchestrator
          psql -c "CREATE DATABASE backstage_plugin_orchestrator;" || echo "Database already exists"
          psql -c "CREATE DATABASE keycloak;" || echo "Database already exists"
          
          # Criar usuários específicos
          psql -c "CREATE USER orchestrator WITH PASSWORD 'orchestrator123';" || echo "User already exists"
          psql -c "CREATE USER keycloak WITH PASSWORD 'keycloak';" || echo "User already exists"
          
          # Grant privileges
          psql -c "GRANT ALL PRIVILEGES ON DATABASE backstage_plugin_orchestrator TO orchestrator;"
          psql -c "GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;"
          
          # Criar schemas no database do orchestrator
          psql -d backstage_plugin_orchestrator -c "CREATE SCHEMA IF NOT EXISTS orchestrator;"
          psql -d backstage_plugin_orchestrator -c "GRANT ALL ON SCHEMA orchestrator TO orchestrator;"
          
          echo "Databases initialized successfully!"
EOF

echo "=== Waiting for database initialization ==="
oc wait job -l app=init-orchestrator-db --for=condition=Complete -n ${NAMESPACE} --timeout=120s 2> /dev/null || true

echo "=== PostgreSQL deployment completed ==="
echo "Connection details:"
echo "  Host: postgresql.${NAMESPACE}.svc.cluster.local"
echo "  Port: 5432"
echo "  Admin User: ${PG_USER}"
echo "  Admin Password: ${PG_PASSWORD}"
echo "  Orchestrator Database: backstage_plugin_orchestrator"
