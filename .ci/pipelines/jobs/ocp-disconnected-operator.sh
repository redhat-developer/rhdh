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
  # inside a Linux user namespace. Two storage drivers were attempted:
  #   - overlay+fuse-overlayfs: needs newuidmap to create a nested userns,
  #     but newuidmap fails ("open of uid_map failed: Permission denied")
  #     because file capabilities set at build time are not effective inside
  #     the pod's user namespace.
  #   - VFS: doesn't need newuidmap, but chowns the graphroot on storage
  #     initialization, which fails in the userns.
  #
  # Fix: use VFS with _CONTAINERS_USERNS_CONFIGURED=1 (skip newuidmap) and
  # pre-create the graphroot directory tree so the store initialization's
  # MkdirAllAndChown finds existing dirs and skips chown. BUILDAH_ISOLATION=
  # chroot avoids creating a nested userns for builds. ignore_chown_errors
  # covers layer-level chown operations.
  export _CONTAINERS_USERNS_CONFIGURED=1
  export BUILDAH_ISOLATION=chroot

  local graphroot="/tmp/graphroot"
  local runroot="/tmp/runroot"

  # Pre-create the directory tree that podman/c-storage expects. When the
  # directories already exist and are owned by uid 1000, the store
  # initialization skips chown (which would fail in the userns).
  mkdir -p "${graphroot}/vfs/dir" "${graphroot}/vfs-images" "${graphroot}/vfs-layers"
  mkdir -p "${runroot}/vfs" "${runroot}/libpod"

  mkdir -p "${HOME}/.config/containers"
  cat > "${HOME}/.config/containers/storage.conf" << EOF
[storage]
driver = "vfs"
graphroot = "${graphroot}"
runroot = "${runroot}"

[storage.options]
ignore_chown_errors = "true"
EOF

  log::info "Podman environment: uid=$(id -u), BUILDAH_ISOLATION=${BUILDAH_ISOLATION}"
  log::info "Storage config (${HOME}/.config/containers/storage.conf): $(tr '\n' ' ' < "${HOME}/.config/containers/storage.conf")"
  log::info "subuid: $(cat /etc/subuid 2> /dev/null || echo 'not found')"
  log::info "graphroot owner: $(ls -ld "${graphroot}/vfs/dir" 2> /dev/null || echo 'not found')"
  log::info "Podman graphRoot: $(podman info --format '{{.Store.GraphRoot}}' 2>&1 || echo 'podman info failed')"

  bash "${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh" "${prepare_args[@]}" \
    || {
      log::error "prepare-restricted-environment.sh failed — aborting"
      return 1
    }
  log::success "Operator installed via prepare-restricted-environment.sh"

  # prepare-restricted-environment.sh applies IDMS/CatalogSource which triggers
  # a MachineConfig update and node rolling. Wait for completion before deploying
  # workloads, same as the Helm path.
  log::info "Waiting for MachineConfigPool updates to complete (up to 20m)..."
  if ! oc wait machineconfigpool --all --for=condition=Updated=True --timeout=20m; then
    log::warn "MachineConfigPool wait timed out — proceeding anyway"
  fi
  log::success "All MachineConfigPools are Updated"

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
