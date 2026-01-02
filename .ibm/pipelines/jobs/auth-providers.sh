#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_auth_providers() {
  local retry_operator_installation="${1:-1}"
  common::oc_login
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"

  # Wait for Backstage CRD to be available after operator installation
  k8s_wait::crd "backstages.rhdh.redhat.com" 300 10 || return 1

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  export AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
  export AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
  LOGS_FOLDER="$(pwd)/e2e-tests/auth-providers-logs"
  export LOGS_FOLDER

  log::info "Running tests ${AUTH_PROVIDERS_RELEASE} in ${AUTH_PROVIDERS_NAMESPACE}"
  run_tests "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}" "${PW_PROJECT_SHOWCASE_AUTH_PROVIDERS}" "https://${K8S_CLUSTER_ROUTER_BASE}"
}
