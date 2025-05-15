#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

install_rhdh_operator() {
  local dir=$1
  local namespace=$2

  configure_namespace "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT,,}" == "false" ]]; then
    setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
  fi
  # Make sure script is up to date
  rm -f /tmp/install-rhdh-catalog-source.sh
  curl -L "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh" > /tmp/install-rhdh-catalog-source.sh
  chmod +x /tmp/install-rhdh-catalog-source.sh
  if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
    echo "Installing RHDH operator with '--next' flag"
    bash -x /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh
  else
    local operator_version="${RELEASE_BRANCH_NAME#release-}"
    echo "Installing RHDH operator with '-v $operator_version' flag"
    bash -x /tmp/install-rhdh-catalog-source.sh -v "$operator_version" --install-operator rhdh
  fi
}

handle_auth_providers() {
  # 

  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}"

  oc_login

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')

  export AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
  export AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
  export LOGS_FOLDER="$(pwd)/e2e-tests/auth-providers-logs"
  echo "Creating log folder ${LOGS_FOLDER}" 
  mkdir -p $LOGS_FOLDER
  ls $LOGS_FOLDER
  run_tests "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}"

}
