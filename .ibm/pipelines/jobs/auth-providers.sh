#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
source "$DIR"/jobs/operator.sh

handle_auth_providers() {
  local retry_operator_installation="${1:-1}"
  oc_login
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${DIR}" "${OPERATOR_MANAGER}" "$retry_operator_installation"
  timeout 300 bash -c '
    while ! oc get crd/backstages.rhdh.redhat.com -n "${namespace}" >/dev/null 2>&1; do
        echo "Waiting for Backstage CRD to be created..."
        sleep 20
    done
    echo "Backstage CRD is created."
    ' || echo "Error: Timed out waiting for Backstage CRD creation."

  export K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')

  export AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
  export AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
  export LOGS_FOLDER="$(pwd)/e2e-tests/auth-providers-logs"

  echo "Running tests ${AUTH_PROVIDERS_RELEASE} in ${AUTH_PROVIDERS_NAMESPACE}"
  run_tests "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}"
}