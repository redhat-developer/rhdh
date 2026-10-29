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
  local registry_host=""
  for _ in $(seq 1 24); do
    registry_host=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}' 2> /dev/null || true)
    if [[ -n "$registry_host" ]]; then
      break
    fi
    sleep 5
  done
  if [[ -z "$registry_host" ]]; then
    log::warn "Image registry default-route did not appear within 120s; continuing"
    return 0
  fi
  # The Route object existing is not enough: right after creation the router/
  # registry data path can still refuse uploads (EOF on blob push,
  # RHDHBUGS-3759). Probe the registry API through the route until it answers.
  local code=""
  for _ in $(seq 1 24); do
    code=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 10 "https://${registry_host}/v2/" || true)
    if [[ "$code" == "200" || "$code" == "401" ]]; then
      log::info "Image registry is serving through the default route"
      return 0
    fi
    sleep 5
  done
  log::warn "Image registry route is not serving yet (last HTTP status: ${code:-none}); continuing"
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
    # TEMPORARY (RHDH 1.9.10 RC validation): the 1.9 IIB tags float past the RC, so pin
    # the IIB digests that carry bundle 1.9-287. Revert once RC testing is complete.
    local ocp_minor="v4.21" # the catalog script's default on non-OpenShift clusters
    if [[ "${IS_OPENSHIFT}" == "true" ]]; then
      ocp_minor="v$(oc version -o json | jq -r '.openshiftVersion' | cut -d. -f1,2)"
    fi
    local catalog_source_args=()
    case "$ocp_minor" in
      v4.18) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:c5d3831f56e9d89e0e84bb4a0769468e16236ad369896a2c2f2ad32564688898") ;;
      v4.19) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:1bd11f21f8bf85753787e2d0fe49abfbc05f9d99ee6efe39e4634ea31ab0db2b") ;;
      v4.20) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:afcfd38b51a22280ae2e35e040e79ce2daa7c993d6fcc8fa8659d5a785dcb273") ;;
      v4.21) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:305a08df14ad0f984aa927616ad29f2d9bededf8c1fb2bac081e10fc71a78e7f") ;;
      v4.22) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:390242c7ca695b4d0df16e9aec3b8dab542e2aa2adb71bba4eee50b257bdd29f") ;;
      v4.23) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:bf2092b1dd94722e38e66cac7035f03d78b697889d905de42e23a11ed68e1fc6") ;;
      v5.0) catalog_source_args=(--catalog-source "quay.io/rhdh/iib@sha256:e12385936574a937d7914c796ff32bb22f825cd741ee0dc57d3f59e75c072daa") ;;
      *) log::warn "No pinned RC IIB for OCP ${ocp_minor}; using the floating ${operator_version} IIB" ;;
    esac
    log::info "Installing RHDH operator with '-v $operator_version ${catalog_source_args[*]}' flags"
    for ((i = 1; i <= max_attempts; i++)); do
      # Not using bash -x to avoid leaking skopeo tokens in CI logs
      if output=$(bash /tmp/install-rhdh-catalog-source.sh -v "$operator_version" "${catalog_source_args[@]}" --install-operator rhdh 2>&1); then
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
