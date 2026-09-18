#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh

# The install script patches the cluster image registry to expose it and
# immediately reads the default-route, which OpenShift takes a few seconds to
# create — a known race (RHDHBUGS-3758). Expose the registry up front and wait
# for the route so the script's own read finds it. Warn-only on timeout: the
# install retry loop still gets its chance.
ensure_registry_default_route() {
  if [[ "${IS_OPENSHIFT}" != "true" ]]; then
    return 0
  fi
  if ! oc patch configs.imageregistry.operator.openshift.io/cluster --type=merge -p '{"spec":{"defaultRoute":true}}'; then
    log::warn "Could not patch the image registry to expose the default route"
    return 0
  fi
  for _ in $(seq 1 24); do
    if oc get route default-route -n openshift-image-registry &> /dev/null; then
      log::info "Image registry default-route is ready"
      return 0
    fi
    sleep 5
  done
  log::warn "Image registry default-route did not appear within 120s; continuing"
}

install_rhdh_operator() {
  local namespace=$1
  local max_attempts=$2

  configure_namespace "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
    setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
  fi
  # Make sure script is up to date
  rm -f /tmp/install-rhdh-catalog-source.sh
  curl -L "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh" > /tmp/install-rhdh-catalog-source.sh
  chmod +x /tmp/install-rhdh-catalog-source.sh

  ensure_registry_default_route
  if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
    log::info "Installing RHDH operator with '--next' flag"
    for ((i = 1; i <= max_attempts; i++)); do
      # Not using bash -x to avoid leaking skopeo tokens in CI logs
      if output=$(bash /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh 2>&1); then
        log::debug "${output}"
        log::success "RHDH Operator installed on attempt ${i}."
        break
      elif ((i < max_attempts)); then
        log::warn "Attempt ${i} failed, retrying in 10 seconds..."
        sleep 10
      elif ((i == max_attempts)); then
        log::error "$output"
        log::error "Failed install RHDH Operator after ${max_attempts} attempts."
        return 1
      fi
    done
  else
    local operator_version="${RELEASE_BRANCH_NAME#release-}"
    if [[ -z "$operator_version" ]]; then
      log::error "Failed to extract operator version from RELEASE_BRANCH_NAME: '$RELEASE_BRANCH_NAME'"
      return 1
    fi
    log::info "Installing RHDH operator with '-v $operator_version' flag"
    for ((i = 1; i <= max_attempts; i++)); do
      # Not using bash -x to avoid leaking skopeo tokens in CI logs
      if output=$(bash /tmp/install-rhdh-catalog-source.sh -v "$operator_version" --install-operator rhdh 2>&1); then
        log::debug "${output}"
        log::success "RHDH Operator installed on attempt ${i}."
        break
      elif ((i == max_attempts)); then
        log::error "${output}"
        log::error "Failed install RHDH Operator after ${max_attempts} attempts."
        return 1
      fi
    done
  fi
}

prepare_operator() {
  local retry_operator_installation="${1:-1}"
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"
}

wait_for_backstage_crd() {
  local namespace=$1
  log::debug "Waiting for Backstage CRD to be created in namespace: ${namespace}"
  timeout 300 bash -c "
  while ! oc get crd/backstages.rhdh.redhat.com -n '${namespace}' >/dev/null 2>&1; do
      echo 'Waiting for Backstage CRD to be created...'
      sleep 20
  done
  " && log::info "Backstage CRD is created in namespace: ${namespace}" || log::error "Timed out waiting for Backstage CRD creation."
}

deploy_rhdh_operator() {
  local namespace=$1
  local backstage_crd_path=$2

  wait_for_backstage_crd "$namespace"
  rendered_yaml=$(envsubst < "$backstage_crd_path")
  log::info "Applying Backstage CRD from: $backstage_crd_path"
  log::debug "$rendered_yaml"
  echo "$rendered_yaml" | oc apply -f - -n "$namespace"
}

delete_rhdh_operator() {
  kubectl delete namespace "$OPERATOR_MANAGER" --ignore-not-found
}
