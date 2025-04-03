#!/bin/sh

set -xe
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] ' # logs timestamp for every cmd.

LOGFILE="test-log"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
secret_name="rhdh-k8s-plugin-secret"
OVERALL_RESULT=0

cleanup() {
  echo "Cleaning up before exiting"
  if [[ "$JOB_NAME" == *aks* ]]; then
    az_aks_stop "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
  else
    # Cleanup namespaces after main branch PR e2e tests execution.
    delete_namespace "${NAME_SPACE}"
    delete_namespace "${NAME_SPACE_POSTGRES_DB}"
    delete_namespace "${NAME_SPACE_RBAC}"
    delete_namespace "${NAME_SPACE_RDS}"
    delete_namespace "${NAME_SPACE_RUNTIME}"
  fi
  rm -rf ~/tmpbin
}

trap cleanup EXIT INT ERR

source "${DIR}/utils.sh"
if [[ "$JOB_NAME" == *aks* ]]; then
  for file in ${DIR}/cluster/aks/*.sh; do source $file; done
elif [[ "$JOB_NAME" == *gke* ]]; then
  for file in ${DIR}/cluster/gke/*.sh; do source $file; done
fi

set_cluster_info() {
  export K8S_CLUSTER_URL=$(cat /tmp/secrets/RHDH_PR_OS_CLUSTER_URL)
  export K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/RHDH_PR_OS_CLUSTER_TOKEN)

  if [[ "$JOB_NAME" == *ocp-v4-14 ]]; then
    K8S_CLUSTER_URL=$(cat /tmp/secrets/RHDH_OS_1_CLUSTER_URL)
    K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/RHDH_OS_1_CLUSTER_TOKEN)
  elif [[ "$JOB_NAME" == *ocp-v4-15 ]]; then
    K8S_CLUSTER_URL=$(cat /tmp/secrets/RHDH_OS_2_CLUSTER_URL)
    K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/RHDH_OS_2_CLUSTER_TOKEN)
  elif [[ "$JOB_NAME" == *aks* ]]; then
    K8S_CLUSTER_URL=$(cat /tmp/secrets/RHDH_AKS_CLUSTER_URL)
    K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/RHDH_AKS_CLUSTER_TOKEN)
  fi
}

set_namespace() {
  if [[ "$JOB_NAME" == *periodic-* ]]; then
    NAME_SPACE="showcase-ci-nightly-1-4"
    NAME_SPACE_RBAC="showcase-rbac-nightly-1-4"
    NAME_SPACE_POSTGRES_DB="postgress-external-db-nightly-1-4"
    NAME_SPACE_K8S="showcase-k8s-ci-nightly"
    NAME_SPACE_RBAC_K8S="showcase-rbac-k8s-ci-nightly"
  elif [[ "$JOB_NAME" == *pull-*-release-1.4-e2e-tests* ]]; then
    # Enable parallel PR testing for main branch by utilizing a pool of namespaces
    local namespaces_pool=("pr-1-4-1" "pr-1-4-2" "pr-1-4-3")
    local namespace_found=false
    # Iterate through namespace pool to find an available set
    for ns in "${namespaces_pool[@]}"; do
      if ! oc get namespace "showcase-$ns" >/dev/null 2>&1; then
        echo "Namespace "showcase-$ns" does not exist, Using NS: showcase-$ns, showcase-rbac-$ns, postgress-external-db-$ns"
        NAME_SPACE="showcase-$ns"
        NAME_SPACE_RBAC="showcase-rbac-$ns"
        NAME_SPACE_POSTGRES_DB="postgress-external-db-$ns"
        namespace_found=true
        break
      fi
    done
    if ! $namespace_found; then
      echo "Error: All namespaces $namespaces_pool already in Use"
      exit 1
    fi
  fi
}

add_helm_repos() {
  helm version

  local repos=(
    "bitnami=https://charts.bitnami.com/bitnami"
    "backstage=https://backstage.github.io/charts"
    "${HELM_REPO_NAME}=${HELM_REPO_URL}"
  )

  for repo in "${repos[@]}"; do
    local key="${repo%%=*}"
    local value="${repo##*=}"

    if ! helm repo list | grep -q "^$key"; then
      helm repo add "$key" "$value"
    else
      echo "Repository $key already exists - updating repository instead."
    fi
  done

  helm repo update
}

install_oc() {
  if command -v oc >/dev/null 2>&1; then
    echo "oc is already installed."
  else
    curl -LO https://mirror.openshift.com/pub/openshift-v4/clients/oc/latest/linux/oc.tar.gz
    tar -xf oc.tar.gz
    mv oc /usr/local/bin/
    rm oc.tar.gz
    echo "oc installed successfully."
  fi
}

install_helm() {
  if command -v helm >/dev/null 2>&1; then
    echo "Helm is already installed."
  else
    echo "Installing Helm 3 client"
    mkdir ~/tmpbin && cd ~/tmpbin
    curl -sL https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash -f
    export PATH=$(pwd):$PATH
    echo "Helm client installed successfully."
  fi
}

uninstall_helmchart() {
  local project=$1
  local release=$2
  if helm list -n "${project}" | grep -q "${release}"; then
    echo "Chart already exists. Removing it before install."
    helm uninstall "${release}" -n "${project}"
  fi
}

configure_namespace() {
  local project=$1
  delete_namespace $project
  oc create namespace "${project}"
  oc config set-context --current --namespace="${project}"
}

delete_namespace() {
  local project=$1
  if oc get namespace "$project" >/dev/null 2>&1; then
    echo "Namespace ${project} exists. Attempting to delete..."

    # Remove blocking finalizers
    remove_finalizers_from_resources "$project"

    # Attempt to delete the namespace
    oc delete namespace "$project" --grace-period=0 --force || true

    # Check if namespace is still stuck in 'Terminating' and force removal if necessary
    if oc get namespace "$project" -o jsonpath='{.status.phase}' | grep -q 'Terminating'; then
      echo "Namespace ${project} is stuck in Terminating. Forcing deletion..."
      force_delete_namespace "$project"
    fi
  fi
}

configure_external_postgres_db() {
  local project=$1
  oc apply -f "${DIR}/resources/postgres-db/postgres.yaml" --namespace="${NAME_SPACE_POSTGRES_DB}"
  sleep 5

  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.ca\.crt}' | base64 --decode > postgres-ca
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.crt}' | base64 --decode > postgres-tls-crt
  oc get secret postgress-external-db-cluster-cert -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath='{.data.tls\.key}' | base64 --decode > postgres-tsl-key

  oc create secret generic postgress-external-db-cluster-cert \
  --from-file=ca.crt=postgres-ca \
  --from-file=tls.crt=postgres-tls-crt \
  --from-file=tls.key=postgres-tsl-key \
  --dry-run=client -o yaml | oc apply -f - --namespace="${project}"

  POSTGRES_PASSWORD=$(oc get secret/postgress-external-db-pguser-janus-idp -n "${NAME_SPACE_POSTGRES_DB}" -o jsonpath={.data.password})
  sed -i "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  POSTGRES_HOST=$(echo -n "postgress-external-db-primary.$NAME_SPACE_POSTGRES_DB.svc.cluster.local" | base64 | tr -d '\n')
  sed -i "s|POSTGRES_HOST:.*|POSTGRES_HOST: ${POSTGRES_HOST}|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "${DIR}/resources/postgres-db/postgres-cred.yaml"  --namespace="${project}"
}

apply_yaml_files() {
  local dir=$1
  local project=$2
  echo "Applying YAML files to namespace ${project}"

  oc config set-context --current --namespace="${project}"

  local files=(
    "$dir/resources/service_account/service-account-rhdh.yaml"
    "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml"
    "$dir/resources/cluster_role/cluster-role-k8s.yaml"
    "$dir/resources/cluster_role/cluster-role-ocm.yaml"
    "$dir/auth/secrets-rhdh-secrets.yaml"
  )

  for file in "${files[@]}"; do
    sed -i "s/namespace:.*/namespace: ${project}/g" "$file"
  done

  if [[ "$JOB_NAME" == *aks* || "$JOB_NAME" == *gke* || "$JOB_NAME" == *operator* ]]; then
    GITHUB_APP_APP_ID=$GITHUB_APP_3_APP_ID
    GITHUB_APP_CLIENT_ID=$GITHUB_APP_3_CLIENT_ID
    GITHUB_APP_PRIVATE_KEY=$GITHUB_APP_3_PRIVATE_KEY
    GITHUB_APP_CLIENT_SECRET=$GITHUB_APP_3_CLIENT_SECRET
  elif [[ "$JOB_NAME" == *pull-*-main-e2e-tests* ]]; then
    # GITHUB_APP_4 for all pr's on main branch.
    GITHUB_APP_APP_ID=$(cat /tmp/secrets/GITHUB_APP_4_APP_ID)
    GITHUB_APP_CLIENT_ID=$(cat /tmp/secrets/GITHUB_APP_4_CLIENT_ID)
    GITHUB_APP_PRIVATE_KEY=$(cat /tmp/secrets/GITHUB_APP_4_PRIVATE_KEY)
    GITHUB_APP_CLIENT_SECRET=$(cat /tmp/secrets/GITHUB_APP_4_CLIENT_SECRET)
  fi

  DH_TARGET_URL=$(echo -n "test-backstage-customization-provider-${project}.${K8S_CLUSTER_ROUTER_BASE}" | base64 -w 0)

  for key in GITHUB_APP_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_PRIVATE_KEY GITHUB_APP_CLIENT_SECRET GITHUB_APP_JANUS_TEST_APP_ID GITHUB_APP_JANUS_TEST_CLIENT_ID GITHUB_APP_JANUS_TEST_CLIENT_SECRET GITHUB_APP_JANUS_TEST_PRIVATE_KEY GITHUB_APP_WEBHOOK_URL GITHUB_APP_WEBHOOK_SECRET KEYCLOAK_CLIENT_SECRET ACR_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET K8S_CLUSTER_TOKEN_ENCODED OCM_CLUSTER_URL GITLAB_TOKEN DH_TARGET_URL; do
    sed -i "s|${key}:.*|${key}: ${!key}|g" "$dir/auth/secrets-rhdh-secrets.yaml"
  done

  oc apply -f "$dir/resources/service_account/service-account-rhdh.yaml" --namespace="${project}"
  oc apply -f "$dir/auth/service-account-rhdh-secret.yaml" --namespace="${project}"
  oc apply -f "$dir/auth/secrets-rhdh-secrets.yaml" --namespace="${project}"
  if [[ "$JOB_NAME" != *aks* && "$JOB_NAME" != *gke*  ]]; then
    oc new-app https://github.com/janus-qe/test-backstage-customization-provider --namespace="${project}"
    oc expose svc/test-backstage-customization-provider --namespace="${project}"
  fi
  oc apply -f "$dir/resources/cluster_role/cluster-role-k8s.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-k8s.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role/cluster-role-ocm.yaml" --namespace="${project}"
  oc apply -f "$dir/resources/cluster_role_binding/cluster-role-binding-ocm.yaml" --namespace="${project}"

  if [[ "$JOB_NAME" != *aks* ]]; then # Skip for AKS, because of strange `sed: -e expression #1, char 136: unterminated `s' command`
    sed -i "s/K8S_CLUSTER_API_SERVER_URL:.*/K8S_CLUSTER_API_SERVER_URL: ${ENCODED_API_SERVER_URL}/g" "$dir/auth/secrets-rhdh-secrets.yaml"
  fi
  sed -i "s/K8S_CLUSTER_NAME:.*/K8S_CLUSTER_NAME: ${ENCODED_CLUSTER_NAME}/g" "$dir/auth/secrets-rhdh-secrets.yaml"

  set +x
  token=$(oc get secret "${secret_name}" -n "${project}" -o=jsonpath='{.data.token}')
  sed -i "s/OCM_CLUSTER_TOKEN: .*/OCM_CLUSTER_TOKEN: ${token}/" "$dir/auth/secrets-rhdh-secrets.yaml"
  set -x

  if [[ "${project}" == *rbac* ]]; then
    oc create configmap app-config-rhdh --from-file="app-config-rhdh.yaml"="$dir/resources/config_map/app-config-rhdh-rbac.yaml" --namespace="${project}" --dry-run=client -o yaml | oc apply -f -
  elif [[ "$JOB_NAME" == *aks* || "$JOB_NAME" == *gke* ]]; then
    yq 'del(.backend.cache)' "$dir/resources/config_map/app-config-rhdh.yaml" \
    | kubectl create configmap app-config-rhdh --from-file="app-config-rhdh.yaml"="/dev/stdin" --namespace="${project}" --dry-run=client -o yaml \
    | kubectl apply -f -
  else
    oc create configmap app-config-rhdh --from-file="app-config-rhdh.yaml"="$dir/resources/config_map/app-config-rhdh.yaml" --namespace="${project}" --dry-run=client -o yaml | oc apply -f -
  fi
  oc create configmap rbac-policy --from-file="rbac-policy.csv"="$dir/resources/config_map/rbac-policy.csv" --namespace="${project}" --dry-run=client -o yaml | oc apply -f -
  oc apply -f "$dir/auth/secrets-rhdh-secrets.yaml" --namespace="${project}"

  #sleep 20 # wait for Pipeline Operator/Tekton pipelines to be ready
  # Renable when namespace termination issue is solved
  # oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline.yaml"
  # oc apply -f "$dir/resources/pipeline-run/hello-world-pipeline-run.yaml"
}

run_tests() {
  local release_name=$1
  local project=$2

  project=${project%-pr-*} # Remove -pr- suffix if any set for main branchs pr's.
  cd "${DIR}/../../e2e-tests"
  local e2e_tests_dir
  e2e_tests_dir=$(pwd)
  yarn install
  yarn playwright install chromium

  Xvfb :99 &
  export DISPLAY=:99

  (
    set -e
    echo "Using PR container image: ${TAG_NAME}"
    yarn "$project"
  ) 2>&1 | tee "/tmp/${LOGFILE}"

  local RESULT=${PIPESTATUS[0]}

  pkill Xvfb

  mkdir -p "${ARTIFACT_DIR}/${project}/test-results"
  mkdir -p "${ARTIFACT_DIR}/${project}/attachments/screenshots"
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${project}/test-results"
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${project}/${JUNIT_RESULTS}"

  if [ -d "${e2e_tests_dir}/screenshots" ]; then
      cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${project}/attachments/screenshots/"
  fi

  ansi2html <"/tmp/${LOGFILE}" >"/tmp/${LOGFILE}.html"
  cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${project}"
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${project}"

  droute_send "${release_name}" "${project}"

  echo "${project} RESULT: ${RESULT}"
  if [ "${RESULT}" -ne 0 ]; then
    OVERALL_RESULT=1
  fi
}

check_backstage_running() {
  local release_name=$1
  local namespace=$2
  if [[ "$JOB_NAME" == *aks* || "$JOB_NAME" == *gke*  ]]; then
    local url="https://${K8S_CLUSTER_ROUTER_BASE}"
  else
    local url="https://${release_name}-backstage-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
  fi

  local max_attempts=30
  local wait_seconds=30

  echo "Checking if Backstage is up and running at ${url}"

  for ((i = 1; i <= max_attempts; i++)); do
    local http_status
    http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}")

    if [ "${http_status}" -eq 200 ]; then
      echo "Backstage is up and running!"
      export BASE_URL="${url}"
      echo "######## BASE URL ########"
      echo "${BASE_URL}"
      return 0
    else
      echo "Attempt ${i} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
      sleep "${wait_seconds}"
    fi
  done

  echo "Failed to reach Backstage at ${BASE_URL} after ${max_attempts} attempts." | tee -a "/tmp/${LOGFILE}"
  cp -a "/tmp/${LOGFILE}" "${ARTIFACT_DIR}/${namespace}/"
  return 1
}

install_tekton_pipelines() {
  local dir=$1

  if oc get pods -n "tekton-pipelines" | grep -q "tekton-pipelines"; then
    echo "Tekton Pipelines are already installed."
  else
    echo "Tekton Pipelines is not installed. Installing..."
    oc apply --filename https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml
  fi
}

install_pipelines_operator() {
  local dir=$1
  DISPLAY_NAME="Red Hat OpenShift Pipelines"

  if oc get csv -n "openshift-operators" | grep -q "${DISPLAY_NAME}"; then
    echo "Red Hat OpenShift Pipelines operator is already installed."
  else
    echo "Red Hat OpenShift Pipelines operator is not installed. Installing..."
    oc apply -f "${dir}/resources/pipeline-run/pipelines-operator.yaml"
  fi
}

initiate_deployments() {

  #install_pipelines_operator
  install_crunchy_postgres_operator
  install_helm
  add_helm_repos

  configure_namespace "${NAME_SPACE}"
  uninstall_helmchart "${NAME_SPACE}" "${RELEASE_NAME}"

  # Deploy redis cache db.
  oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE}"

  cd "${DIR}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}"
  echo "[DEBUG] Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" -f "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" --set upstream.backstage.image.repository="${QUAY_REPO}" --set upstream.backstage.image.tag="${TAG_NAME}"

  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${NAME_SPACE_RBAC}"
  configure_external_postgres_db "${NAME_SPACE_RBAC}"

  uninstall_helmchart "${NAME_SPACE_RBAC}" "${RELEASE_NAME_RBAC}"
  apply_yaml_files "${DIR}" "${NAME_SPACE_RBAC}"
  echo "[DEBUG] Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${RELEASE_NAME_RBAC}"
  helm upgrade -i "${RELEASE_NAME_RBAC}" -n "${NAME_SPACE_RBAC}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" -f "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" --set upstream.backstage.image.repository="${QUAY_REPO}" --set upstream.backstage.image.tag="${TAG_NAME}"
}

initiate_rds_deployment() {
  local release_name=$1
  local namespace=$2
  configure_namespace "${namespace}"
  uninstall_helmchart "${namespace}" "${release_name}"
  sed -i "s|POSTGRES_USER:.*|POSTGRES_USER: $RDS_USER|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_PASSWORD:.*|POSTGRES_PASSWORD: $(echo -n $RDS_PASSWORD | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  sed -i "s|POSTGRES_HOST:.*|POSTGRES_HOST: $(echo -n $RDS_1_HOST | base64 -w 0)|g" "${DIR}/resources/postgres-db/postgres-cred.yaml"
  oc apply -f "$DIR/resources/postgres-db/postgres-crt-rds.yaml" -n "${namespace}"
  oc apply -f "$DIR/resources/postgres-db/postgres-cred.yaml" -n "${namespace}"
  oc apply -f "$DIR/resources/postgres-db/dynamic-plugins-root-PVC.yaml" -n "${namespace}"
  helm upgrade -i "${release_name}" -n "${namespace}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" -f "$DIR/resources/postgres-db/values-showcase-postgres.yaml" --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" --set upstream.backstage.image.repository="${QUAY_REPO}" --set upstream.backstage.image.tag="${TAG_NAME}"
}

check_and_test() {
  local release_name=$1
  local namespace=$2
  if check_backstage_running "${release_name}" "${namespace}"; then
    echo "Display pods for verification..."
    oc get pods -n "${namespace}"
    run_tests "${release_name}" "${namespace}"
  else
    echo "Backstage is not running. Exiting..."
    OVERALL_RESULT=1
  fi
  save_all_pod_logs $namespace
}

# Function to remove finalizers from specific resources in a namespace that are blocking deletion.
remove_finalizers_from_resources() {
  local project=$1
  echo "Removing finalizers from resources in namespace ${project} that are blocking deletion."

  # Remove finalizers from stuck PipelineRuns and TaskRuns
  for resource_type in "pipelineruns.tekton.dev" "taskruns.tekton.dev"; do
    for resource in $(oc get "$resource_type" -n "$project" -o name); do
      oc patch "$resource" -n "$project" --type='merge' -p '{"metadata":{"finalizers":[]}}' || true
      echo "Removed finalizers from $resource in $project."
    done
  done

  # Check and remove specific finalizers stuck on 'chains.tekton.dev' resources
  for chain_resource in $(oc get pipelineruns.tekton.dev,taskruns.tekton.dev -n "$project" -o name); do
    oc patch "$chain_resource" -n "$project" --type='json' -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
    echo "Removed Tekton finalizers from $chain_resource in $project."
  done
}

# Function to forcibly delete a namespace stuck in 'Terminating' status
force_delete_namespace() {
  local project=$1
  echo "Forcefully deleting namespace ${project}."
  oc get namespace "$project" -o json | jq '.spec = {"finalizers":[]}' | oc replace --raw "/api/v1/namespaces/$project/finalize" -f -
}

main() {
  echo "Log file: ${LOGFILE}"
  set_cluster_info
  source "${DIR}/env_variables.sh"

  install_oc
  if [[ "$JOB_NAME" == *aks* ]]; then
    az_login
    az_aks_start "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
    az_aks_approuting_enable "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
    az_aks_get_credentials "${AKS_NIGHTLY_CLUSTER_NAME}" "${AKS_NIGHTLY_CLUSTER_RESOURCEGROUP}"
  elif [[ "$JOB_NAME" == *gke* ]]; then
    gcloud_auth "${GKE_SERVICE_ACCOUNT_NAME}" "/tmp/secrets/GKE_SERVICE_ACCOUNT_KEY"
    gcloud_gke_get_credentials "${GKE_CLUSTER_NAME}" "${GKE_CLUSTER_REGION}" "${GOOGLE_CLOUD_PROJECT}"
  else
    oc login --token="${K8S_CLUSTER_TOKEN}" --server="${K8S_CLUSTER_URL}"
  fi
  echo "OCP version: $(oc version)"

  set_namespace

  API_SERVER_URL=$(oc whoami --show-server)
  if [[ "$JOB_NAME" == *aks* ]]; then
    export K8S_CLUSTER_ROUTER_BASE=$AKS_INSTANCE_DOMAIN_NAME
  elif [[ "$JOB_NAME" == *gke* ]]; then
    export K8S_CLUSTER_ROUTER_BASE=$GKE_INSTANCE_DOMAIN_NAME
  else
    export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  fi

  echo "K8S_CLUSTER_ROUTER_BASE : $K8S_CLUSTER_ROUTER_BASE"

  ENCODED_API_SERVER_URL=$(echo "${API_SERVER_URL}" | base64)
  ENCODED_CLUSTER_NAME=$(echo "my-cluster" | base64)

  if [[ "$JOB_NAME" == *aks* ]]; then
    initiate_aks_deployment
    check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}"
    delete_namespace "${NAME_SPACE_K8S}"
    initiate_rbac_aks_deployment
    check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}"
    delete_namespace "${NAME_SPACE_RBAC_K8S}"
  elif [[ "$JOB_NAME" == *gke* ]]; then
    initiate_gke_deployment
    check_and_test "${RELEASE_NAME}" "${NAME_SPACE_K8S}"
    delete_namespace "${NAME_SPACE_K8S}"
    initiate_rbac_gke_deployment
    check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC_K8S}"
    delete_namespace "${NAME_SPACE_RBAC_K8S}"
  else
    initiate_deployments
    check_and_test "${RELEASE_NAME}" "${NAME_SPACE}"
    check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}"
    # Only test TLS config with RDS and Change configuration at runtime in nightly jobs
    if [[ "$JOB_NAME" == *periodic* ]]; then
      # initiate_rds_deployment "${RELEASE_NAME}" "${NAME_SPACE_RDS}"
      # check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RDS}"

      # Deploy `showcase-runtime` to run tests that require configuration changes at runtime
      configure_namespace "${NAME_SPACE_RUNTIME}"
      uninstall_helmchart "${NAME_SPACE_RUNTIME}" "${RELEASE_NAME}"
      oc apply -f "$DIR/resources/redis-cache/redis-deployment.yaml" --namespace="${NAME_SPACE_RUNTIME}"
      apply_yaml_files "${DIR}" "${NAME_SPACE_RUNTIME}"
      helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE_RUNTIME}" "${HELM_REPO_NAME}/${HELM_IMAGE_NAME}" --version "${CHART_VERSION}" -f "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" --set upstream.backstage.image.repository="${QUAY_REPO}" --set upstream.backstage.image.tag="${TAG_NAME}"
      check_and_test "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}"
    fi
  fi

  exit "${OVERALL_RESULT}"
}

main
