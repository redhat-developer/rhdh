#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/disconnected.sh
source "$DIR"/lib/disconnected.sh

export INSTALL_METHOD="operator"

handle_ocp_disconnected_operator() {
  export NAME_SPACE="${NAME_SPACE:-showcase-disconnected}"

  disconnected::require_env
  disconnected::setup_auth

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  # --- Section A: Operator Mirroring + Installation ---
  # Uses prepare-restricted-environment.sh from rhdh-operator, which handles
  # mirroring operator/operand images and installing the operator CatalogSource.
  # Requires podman for building custom operator index images.
  log::section "Operator Mirroring and Installation"

  if ! command -v podman &> /dev/null; then
    log::info "Installing podman (required by prepare-restricted-environment.sh)..."
    if ! apt-get update 2>&1; then
      log::warn "apt-get update failed — continuing anyway"
    fi
    if ! apt-get install -y podman 2>&1; then
      log::error "apt-get install podman failed"
    fi
    hash -r
    if ! command -v podman &> /dev/null; then
      log::error "podman not available after install. Add podman to the rhdh-e2e-runner Dockerfile."
      return 1
    fi
    log::success "podman installed: $(podman --version)"
  fi

  disconnected::fetch_script "prepare-restricted-environment.sh" "${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh" \
    || {
      log::error "Failed to fetch prepare-restricted-environment.sh — aborting"
      return 1
    }

  local prepare_args=(
    --to-registry "${MIRROR_REGISTRY_URL}"
    --filter-versions "${RELEASE_VERSION}"
  )
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    prepare_args=(
      --to-registry "${MIRROR_REGISTRY_URL}"
      --index-image "${CATALOG_INDEX_IMAGE}"
      --ci-index true
      --filter-versions "${RELEASE_VERSION}"
    )
  fi

  bash "${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh" "${prepare_args[@]}" \
    || {
      log::error "prepare-restricted-environment.sh failed — aborting"
      return 1
    }
  log::success "Operator installed via prepare-restricted-environment.sh"

  # --- Section B: Wait for Operator CRD ---
  k8s_wait::crd "backstages.rhdh.redhat.com" 300 10 || {
    log::error "Backstage CRD not available after operator installation"
    return 1
  }

  # --- Section C: Plugin Mirroring ---
  log::section "Plugin Mirroring"

  disconnected::fetch_script "mirror-plugins.sh" "${DISCONNECTED_TMPDIR}/mirror-plugins.sh" \
    || {
      log::error "Failed to fetch mirror-plugins.sh — aborting"
      return 1
    }

  local plugin_index="oci://registry.access.redhat.com/rhdh/plugin-catalog-index:${RELEASE_VERSION}"
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    plugin_index="oci://${CATALOG_INDEX_IMAGE}"
  fi

  bash "${DISCONNECTED_TMPDIR}/mirror-plugins.sh" \
    --plugin-index "${plugin_index}" \
    --to-registry "${MIRROR_REGISTRY_URL}" || {
    log::error "mirror-plugins.sh failed — aborting"
    return 1
  }

  # --- Section D: Namespace + registries.conf ConfigMap ---
  log::section "Cluster Resources"

  namespace::configure "${NAME_SPACE}"

  envsubst < "${DIR}/resources/disconnected/plugin-mirror-configmap.yaml" \
    | oc apply -n "${NAME_SPACE}" -f - || {
    log::error "Failed to create registries.conf ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-conf created in ${NAME_SPACE}"

  envsubst < "${DIR}/resources/disconnected/plugin-mirror-configmap.yaml" \
    > "${ARTIFACT_DIR}/disconnected-plugin-mirror-configmap.yaml" 2> /dev/null || true

  # --- Section E: Backstage CR Deployment ---
  log::section "Backstage CR Deployment"

  local rendered_cr
  rendered_cr=$(envsubst < "${DIR}/resources/rhdh-operator/rhdh-start.yaml")
  rendered_cr=$(echo "$rendered_cr" | yq eval \
    '.spec.application.extraFiles.configMaps = [
      {
        "name": "rhdh-plugin-mirror-conf",
        "key": "rhdh-registries.conf",
        "mountPath": "/etc/containers/registries.conf.d",
        "containers": ["install-dynamic-plugins"]
      }
    ]' -)

  local cr_temp="${DISCONNECTED_TMPDIR}/backstage-cr-disconnected.yaml"
  echo "$rendered_cr" > "${cr_temp}"

  cp "${cr_temp}" "${ARTIFACT_DIR}/disconnected-backstage-cr.yaml" 2> /dev/null || true

  deploy_rhdh_operator "${NAME_SPACE}" "${cr_temp}"
  log::success "Backstage CR deployed in ${NAME_SPACE}"

  # --- Section F: Smoke Test ---
  log::section "Smoke Test"

  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Operator smoke test completed"
}
