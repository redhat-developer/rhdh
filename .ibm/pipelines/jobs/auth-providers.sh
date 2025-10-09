#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

handle_auth_providers() {
  local retry_operator_installation="${1:-1}"
  oc_login
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"
  wait_for_backstage_crd "default"

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  export AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
  export AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
  LOGS_FOLDER="$(pwd)/e2e-tests/auth-providers-logs"
  export LOGS_FOLDER

  echo "Running tests ${AUTH_PROVIDERS_RELEASE} in ${AUTH_PROVIDERS_NAMESPACE}"
  run_tests "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}"
}
