#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh

wait_for_image_registry_route() {
  log::info "Ensuring OpenShift image registry route is available..."
  oc patch configs.imageregistry.operator.openshift.io/cluster \
    --patch '{"spec":{"defaultRoute":true}}' --type=merge

  local max_attempts=30
  local wait_interval=10
  for ((i = 1; i <= max_attempts; i++)); do
    local registry_host
    registry_host=$(oc get route default-route -n openshift-image-registry \
      --template='{{ .spec.host }}' 2> /dev/null) || true
    if [[ -n "$registry_host" ]]; then
      local http_status
      http_status=$(curl -sk -o /dev/null -w "%{http_code}" \
        "https://${registry_host}/v2/" 2> /dev/null) || true
      if [[ "$http_status" != "503" && "$http_status" != "000" ]]; then
        log::info "Image registry is ready at ${registry_host} (HTTP ${http_status})"
        return 0
      fi
      log::debug "Registry not ready (HTTP ${http_status}), attempt ${i}/${max_attempts}"
    else
      log::debug "Waiting for registry route, attempt ${i}/${max_attempts}"
    fi
    sleep "$wait_interval"
  done

  log::warn "Image registry may not be fully ready, proceeding anyway..."
}

handle_auth_providers() {
  local retry_operator_installation="${1:-2}"
  common::oc_login
  configure_namespace "${OPERATOR_MANAGER}"
  wait_for_image_registry_route
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"
  wait_for_backstage_crd "default"

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  export AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
  export AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
  LOGS_FOLDER="$(pwd)/e2e-tests/auth-providers-logs"
  export LOGS_FOLDER

  log::info "Running tests ${AUTH_PROVIDERS_RELEASE} in ${AUTH_PROVIDERS_NAMESPACE}"
  run_tests "${AUTH_PROVIDERS_RELEASE}" "${AUTH_PROVIDERS_NAMESPACE}" "${PW_PROJECT_SHOWCASE_AUTH_PROVIDERS}" "https://${K8S_CLUSTER_ROUTER_BASE}"
}
