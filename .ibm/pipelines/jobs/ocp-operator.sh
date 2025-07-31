#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

initiate_operator_deployments() {
  echo "Initiating Operator-backed deployments on OCP"

  prepare_operator

  configure_namespace "${NAME_SPACE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local rhdh_base_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins.yaml -n "${NAME_SPACE}"
  deploy_redis_cache "${NAME_SPACE}"
  deploy_rhdh_operator "${NAME_SPACE}" "${DIR}/resources/rhdh-operator/rhdh-start.yaml"

  configure_namespace "${NAME_SPACE_RBAC}"
  create_conditional_policies_operator /tmp/conditional-policies.yaml
  prepare_operator_app_config "${DIR}/resources/config_map/app-config-rhdh-rbac.yaml"
  local rbac_rhdh_base_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}" "${rbac_rhdh_base_url}"
  create_dynamic_plugins_config "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "/tmp/configmap-dynamic-plugins-rbac.yaml"
  oc apply -f /tmp/configmap-dynamic-plugins-rbac.yaml -n "${NAME_SPACE_RBAC}"
  deploy_rhdh_operator "${NAME_SPACE_RBAC}" "${DIR}/resources/rhdh-operator/rhdh-start-rbac.yaml"
}

deploy_serverless_operators() {
  local namespace=$1
  echo "Installing serverless operators for orchestrator in namespace: $namespace"
  
  # Create serverless-logic namespace if it doesn't exist
  oc create namespace openshift-serverless-logic --dry-run=client -o yaml | oc apply -f -
  
  # Create serverless namespace if it doesn't exist  
  oc create namespace openshift-serverless --dry-run=client -o yaml | oc apply -f -
  
  # Install Logic Operator (SonataFlow)
  cat <<EOF | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: logic-operator-rhel8
  namespace: openshift-serverless-logic
spec:
  channel: stable
  installPlanApproval: Automatic
  name: logic-operator-rhel8
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF

  # Install Serverless Operator (Knative)
  cat <<EOF | oc apply -f -
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: serverless-operator
  namespace: openshift-serverless
spec:
  channel: stable
  installPlanApproval: Automatic
  name: serverless-operator
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF

  echo "Waiting for serverless operators to be ready..."
  timeout 300 bash -c "
    while ! oc get csv -n openshift-serverless-logic | grep -q 'logic-operator.*Succeeded'; do
      echo 'Waiting for Logic Operator to be ready...'
      sleep 20
    done
    echo 'Logic Operator is ready.'
  "
  
  timeout 300 bash -c "
    while ! oc get csv -n openshift-serverless | grep -q 'serverless-operator.*Succeeded'; do
      echo 'Waiting for Serverless Operator to be ready...'
      sleep 20
    done
    echo 'Serverless Operator is ready.'
  "
}

create_orchestrator_database() {
  local namespace=$1
  local orch_db=${2:-backstage_plugin_orchestrator}
  
  echo "Creating orchestrator database: $orch_db in namespace: $namespace"
  
  # Find PostgreSQL pod
  local psql_pod=$(oc get pods -n "$namespace" -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  if [[ -z "$psql_pod" ]]; then
    psql_pod=$(oc get pods -n "$namespace" | grep -E '(postgres|psql)' | head -1 | awk '{print $1}')
  fi
  
  if [[ -z "$psql_pod" ]]; then
    echo "ERROR: No PostgreSQL pod found in namespace $namespace"
    return 1
  fi
  
  echo "Using PostgreSQL pod: $psql_pod"
  
  # Create orchestrator database
  oc exec -i "$psql_pod" -n "$namespace" -- psql -U postgres -d postgres <<EOF
SELECT 'CREATE DATABASE $orch_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$orch_db')\gexec
GRANT ALL PRIVILEGES ON DATABASE $orch_db TO postgres;
EOF
  
  echo "Orchestrator database $orch_db created successfully"
}

apply_sonataflow_resources() {
  local namespace=$1
  local backstage_name=${2:-developer-hub}
  
  echo "Applying SonataFlow platform resources in namespace: $namespace"
  
  # Apply SonataFlow platform configuration
  cat <<EOF | oc apply -f -
apiVersion: sonataflow.org/v1alpha08
kind: SonataFlowPlatform
metadata:
  name: sonataflow-platform
  namespace: $namespace
spec:
  build:
    config:
      strategyOptions:
        KanikoBuildCacheEnabled: "true"
    template:
      buildArgs:
        - name: QUARKUS_EXTENSIONS
          value: org.kie:kie-addons-quarkus-persistence-jdbc:999-SNAPSHOT,io.quarkus:quarkus-jdbc-postgresql:3.2.9.Final,io.quarkus:quarkus-agroal:3.2.9.Final
      resources:
        requests:
          memory: "64Mi"
          cpu: "250m"
        limits:
          memory: "1Gi"
          cpu: "500m"
  services:
    dataIndex:
      enabled: true
      persistence:
        postgresql:
          serviceRef:
            name: postgres-service
            port: 5432
            databaseName: backstage_plugin_orchestrator
            databaseSchema: data-index-service
      podTemplate:
        container:
          resources:
            requests:
              memory: "64Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "500m"
    jobService:
      enabled: true
      persistence:
        postgresql:
          serviceRef:
            name: postgres-service
            port: 5432
            databaseName: backstage_plugin_orchestrator
            databaseSchema: jobs-service
      podTemplate:
        container:
          resources:
            requests:
              memory: "64Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "500m"
EOF

  echo "SonataFlow platform resources applied successfully"
}

deploy_orchestrator_operator() {
  local namespace=$1
  local backstage_name=${2:-developer-hub}
  
  echo "Deploying orchestrator operator setup in namespace: $namespace"
  
  # Deploy serverless operators
  deploy_serverless_operators "$namespace"
  
  # Create orchestrator database
  create_orchestrator_database "$namespace" "backstage_plugin_orchestrator"
  
  # Apply SonataFlow platform resources
  apply_sonataflow_resources "$namespace" "$backstage_name"
  
  # Create orchestrator dynamic plugins configmap
  oc create configmap dynamic-plugins-orchestrator-config \
    --from-file="${DIR}/resources/config_map/dynamic-plugins-orchestrator-config.yaml" \
    -n "$namespace" --dry-run=client -o yaml | oc apply -f -
  
  # Deploy RHDH with orchestrator configuration
  deploy_rhdh_operator "$namespace" "${DIR}/resources/rhdh-operator/rhdh-start-orchestrator.yaml"
  
  echo "Orchestrator operator deployment completed"
}

run_operator_runtime_config_change_tests() {
  # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
  configure_namespace "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  sed -i "s|POSTGRES_USER:.*|POSTGRES_USER: $RDS_USER|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: $(echo -n $RDS_PASSWORD | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_HOST:.*|POSTGRES_HOST: $(echo -n $RDS_1_HOST | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|RHDH_RUNTIME_URL:.*|RHDH_RUNTIME_URL: $(echo -n $runtime_url | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "$DIR/resources/postgres-db/postgres-crt-rds.yaml" -n "${NAME_SPACE_RUNTIME}"
  oc apply -f "$DIR/resources/postgres-db/postgres-cred.yaml" -n "${NAME_SPACE_RUNTIME}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${NAME_SPACE_RUNTIME}"
  create_app_config_map "$DIR/resources/postgres-db/rds-app-config.yaml" "${NAME_SPACE_RUNTIME}"
  local runtime_url="https://backstage-${RELEASE_NAME}-${NAME_SPACE_RUNTIME}.${K8S_CLUSTER_ROUTER_BASE}"
  deploy_rhdh_operator "${NAME_SPACE_RUNTIME}" "${DIR}/resources/rhdh-operator/rhdh-start-runtime.yaml"
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${runtime_url}"
}

run_operator_orchestrator_tests() {
  # Deploy orchestrator-enabled RHDH for e2e testing
  export NAME_SPACE_ORCHESTRATOR="${NAME_SPACE_ORCHESTRATOR:-rhdh-operator-orchestrator}"
  configure_namespace "${NAME_SPACE_ORCHESTRATOR}"
  
  local orchestrator_url="https://backstage-rhdh-orchestrator-${NAME_SPACE_ORCHESTRATOR}.${K8S_CLUSTER_ROUTER_BASE}"
  
  echo "Deploying orchestrator operator setup for e2e testing..."
  deploy_orchestrator_operator "${NAME_SPACE_ORCHESTRATOR}" "rhdh-orchestrator"
  
  echo "Running orchestrator e2e tests..."
  check_and_test "rhdh-orchestrator" "${NAME_SPACE_ORCHESTRATOR}" "${orchestrator_url}"
}

handle_ocp_operator() {
  oc_login

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local rbac_url="https://backstage-${RELEASE_NAME_RBAC}-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"

  cluster_setup_ocp_operator
  initiate_operator_deployments
  check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${rbac_url}"

  run_operator_runtime_config_change_tests
}
