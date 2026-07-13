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

  # Uses prepare-restricted-environment.sh from rhdh-operator, which handles
  # mirroring operator/operand images and installing the operator CatalogSource.
  log::section "Operator Mirroring and Installation"

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

  # The CI pod runs with nested_podman: true (hostUsers: false), placing it
  # inside a Linux user namespace. podman's rootless setup calls newuidmap to
  # create a nested user namespace, which fails with:
  #   newuidmap: open of uid_map failed: Permission denied
  # And chowns the storage graphroot, which fails with:
  #   chown .../storage/vfs/dir: operation not permitted
  # Fix:
  #   _CONTAINERS_USERNS_CONFIGURED=1 — skip newuidmap (userns already set up)
  #   BUILDAH_ISOLATION=chroot — chroot instead of user namespace for builds
  #   graphroot/runroot in DISCONNECTED_TMPDIR — pre-owned by uid 1000, so
  #     podman skips chown during storage init
  #   ignore_chown_errors — safety net for layer operations
  export _CONTAINERS_USERNS_CONFIGURED=1
  export BUILDAH_ISOLATION=chroot

  local podman_storage="${DISCONNECTED_TMPDIR}/podman-storage"
  local podman_run="${DISCONNECTED_TMPDIR}/podman-run"
  mkdir -p "${podman_storage}" "${podman_run}"

  mkdir -p "${HOME}/.config/containers"
  cat > "${HOME}/.config/containers/storage.conf" << EOF
[storage]
driver = "vfs"
graphroot = "${podman_storage}"
runroot = "${podman_run}"

[storage.options]
ignore_chown_errors = "true"
EOF
  export CONTAINERS_STORAGE_CONF="${HOME}/.config/containers/storage.conf"

  log::info "Podman environment: uid=$(id -u), BUILDAH_ISOLATION=${BUILDAH_ISOLATION}"
  log::info "Storage config: $(cat "${CONTAINERS_STORAGE_CONF}" | tr '\n' ' ')"
  log::info "subuid: $(cat /etc/subuid 2> /dev/null || echo 'not found')"

  bash "${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh" "${prepare_args[@]}" \
    || {
      log::error "prepare-restricted-environment.sh failed — aborting"
      return 1
    }
  log::success "Operator installed via prepare-restricted-environment.sh"

  k8s_wait::crd "backstages.rhdh.redhat.com" 300 10 || {
    log::error "Backstage CRD not available after operator installation"
    return 1
  }

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

  log::section "Namespace and Secrets"

  namespace::configure "${NAME_SPACE}"

  envsubst < "${DIR}/resources/disconnected/plugin-mirror-configmap.yaml" \
    | oc apply -n "${NAME_SPACE}" -f - || {
    log::error "Failed to create registries.conf ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-conf created in ${NAME_SPACE}"

  envsubst < "${DIR}/resources/disconnected/plugin-mirror-configmap.yaml" \
    > "${ARTIFACT_DIR}/disconnected-plugin-mirror-configmap.yaml" 2> /dev/null || true

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

  log::section "Smoke Test"

  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Operator smoke test completed"
}
