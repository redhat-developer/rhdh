#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
source "$DIR"/install-methods/operator.sh

handle_auth_providers() {
  local retry_operator_installation="${1:-1}"
  oc_login
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}" "$retry_operator_installation"
  wait_for_backstage_crd "default"

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')

  export AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
  export AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
  export LOGS_FOLDER="$(pwd)/e2e-tests/auth-providers-logs"

  echo "Running tests ${AUTH_PROVIDERS_RELEASE} in ${AUTH_PROVIDERS_NAMESPACE}"
  run_tests "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}"
}
