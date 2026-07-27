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
  # Force a dedicated namespace (env_variables.sh may already set NAME_SPACE=showcase).
  export NAME_SPACE="showcase-disconnected"

  disconnected::require_env
  disconnected::setup_auth

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  # Uses prepare-restricted-environment.sh from rhdh-operator, which handles
  # mirroring operator/operand images and installing the operator CatalogSource.
  log::section "Operator Mirroring and Installation"

  # Fetch prepare-restricted-environment.sh from RELEASE_BRANCH_NAME (default
  # main). rhdh-operator#3259 (native oc-mirror cc-* catalogs for OLM v1) is
  # merged on main.
  local prepare_script_path="${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh"
  disconnected::fetch_script "prepare-restricted-environment.sh" \
    "${prepare_script_path}" || {
    log::error "Failed to fetch prepare-restricted-environment.sh — aborting"
    return 1
  }

  # Use oc-mirror (documented air-gapped OCP path) instead of the script's
  # default skopeo/umoci/podman-build path. Nested Podman in this CI pod cannot
  # initialize storage (newuidmap / VFS chown both fail under hostUsers: false).
  # CATALOG_INDEX_IMAGE is the plugin catalog index — do not pass it as
  # --index-image (OLM operator catalog). Keep it for mirror-plugins.sh below.
  #
  # OLM version: leave default (auto). On OCP 4.21+ this selects OLM v1.
  local filter_versions="${RELEASE_VERSION}"
  if [[ "${filter_versions}" == "next" || "${filter_versions}" == "*" ]]; then
    filter_versions="*"
  fi

  # CONTAINER_PLATFORM_VERSION is set by e2e-tests/container-init.sh from the
  # live cluster (oc version → major.minor).
  local ocp_version="${CONTAINER_PLATFORM_VERSION:-}"
  if [[ -z "${ocp_version}" || "${ocp_version}" == "unknown" || ! "${ocp_version}" =~ ^[0-9]+\.[0-9]+$ ]]; then
    log::error "CONTAINER_PLATFORM_VERSION is unset or invalid ('${ocp_version}'); expected OpenShift major.minor"
    return 1
  fi
  local index_image="registry.redhat.io/redhat/redhat-operator-index:v${ocp_version}"
  log::info "Using OCP ${ocp_version} (CONTAINER_PLATFORM_VERSION); index image ${index_image}"

  local prepare_args=(
    --use-oc-mirror true
    --to-registry "${MIRROR_REGISTRY_URL}"
    --index-image "${index_image}"
    --filter-versions "${filter_versions}"
  )

  # prepare-restricted-environment.sh skips OLM v1 pull-secret/CA setup for
  # external registries. Catalogd must trust the mirror CA and authenticate
  # before ClusterCatalog can reach Serving=True.
  disconnected::ensure_olm_mirror_pull_secret || return 1
  disconnected::ensure_mirror_registry_ca || return 1
  disconnected::wait_mcp_updated

  log::info "Running prepare-restricted-environment.sh with: ${prepare_args[*]}"
  if ! disconnected::with_unset_registry_auth_file \
    bash "${prepare_script_path}" "${prepare_args[@]}"; then
    log::error "prepare-restricted-environment.sh failed — aborting"
    return 1
  fi
  log::success "Operator installed via prepare-restricted-environment.sh"

  # prepare patches the operator SA with internal-registry secret names that do
  # not exist for an external mirror. Provide a real mirror pull secret and
  # attach it to the OLM v1 installer SA used by ClusterExtension.
  local operator_ns="rhdh-operator"
  oc create secret generic reg-pull-secret \
    --from-file=.dockerconfigjson="${MIRROR_REGISTRY_PULL_SECRET}" \
    --type=kubernetes.io/dockerconfigjson \
    -n "${operator_ns}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create reg-pull-secret in ${operator_ns}"
    return 1
  }
  oc patch serviceaccount rhdh-operator-installer -n "${operator_ns}" --type=merge \
    -p '{"imagePullSecrets":[{"name":"reg-pull-secret"}]}' || {
    log::warn "Failed to patch rhdh-operator-installer imagePullSecrets — continuing"
  }
  log::success "Configured mirror pull secret on rhdh-operator-installer SA"

  # prepare-restricted-environment.sh applies IDMS/CatalogSource which triggers
  # a MachineConfig update and node rolling. Wait for completion before deploying
  # workloads, same as the Helm path.
  disconnected::wait_mcp_updated

  # prepare only creates the ClusterExtension; wait until OLM v1 installs the
  # operator and the Backstage CRD appears (dump status on timeout).
  disconnected::wait_operator_crd_olm_v1 "rhdh-operator" "backstages.rhdh.redhat.com" 600 || {
    log::error "Backstage CRD not available after operator installation"
    return 1
  }

  log::section "Plugin Mirroring"
  disconnected::mirror_plugins || return 1

  # Homepage ("Welcome back!") comes from dynamic-plugins.default.yaml inside the
  # catalog index. Clearing CATALOG_INDEX_IMAGE skips that file and / 404s after
  # guest login. Rewrite to the index already pushed by mirror_plugins (same
  # path under MIRROR_REGISTRY_URL). Do this AFTER mirroring so mirror_plugins
  # still resolves the upstream/index override correctly.
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    export CATALOG_INDEX_IMAGE="${MIRROR_REGISTRY_URL}/${CATALOG_INDEX_IMAGE#*/}"
  else
    export CATALOG_INDEX_IMAGE="${MIRROR_REGISTRY_URL}/rhdh/plugin-catalog-index:${RELEASE_VERSION}"
  fi
  log::info "Using mirrored CATALOG_INDEX_IMAGE=${CATALOG_INDEX_IMAGE}"

  # Hub must match the catalog index tag (nightly :next). CSV GA hub lacks the
  # local homepage path referenced by plugin-catalog-index:next. Mirror the CI
  # hub like Helm's oc-mirror additionalImages, then point the CR at the mirror.
  log::section "Hub Image Mirroring"
  disconnected::mirror_hub_image || return 1
  # RELATED_IMAGE_backstage overrides install-dynamic-plugins after CR patches
  # (operator getInitContainer clobber). Must run before the Backstage CR.
  disconnected::set_operator_related_hub_image "rhdh-operator" || return 1

  log::section "Namespace and Secrets"

  namespace::configure "${NAME_SPACE}"
  disconnected::apply_plugin_mirror_configmap "${NAME_SPACE}" || return 1
  # Same CA/auth secrets as Helm so skopeo in install-dynamic-plugins can pull
  # from the mirror (registries.conf alone is not enough — TLS verify fails).
  disconnected::create_mirror_registry_ca_configmap "${NAME_SPACE}" || return 1
  disconnected::create_plugin_registry_auth_secret "${NAME_SPACE}" || return 1

  # Kubelet pull of ${MIRROR_REGISTRY_URL}/${IMAGE_REPO}:${TAG_NAME} (CR patch).
  # Cluster pull-secret is already merged; namespace secret + imagePullSecrets
  # matches the K8s operator CR pattern and avoids relying on that alone.
  oc create secret generic mirror-registry-pull \
    --from-file=.dockerconfigjson="${MIRROR_REGISTRY_PULL_SECRET}" \
    --type=kubernetes.io/dockerconfigjson \
    -n "${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create mirror-registry-pull secret — aborting"
    return 1
  }
  log::success "Secret mirror-registry-pull created in ${NAME_SPACE}"

  # Operator mounts one volume per extraFiles ConfigMap name. policy.json cannot
  # share rhdh-plugin-mirror-conf or reconcile fails with duplicate volume keys.
  oc create configmap rhdh-plugin-mirror-policy \
    --from-literal='policy.json={"default":[{"type":"insecureAcceptAnything"}]}' \
    -n "${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create rhdh-plugin-mirror-policy ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-policy created in ${NAME_SPACE}"

  log::section "Backstage CR Deployment"

  # Minimal guest-auth ConfigMap (full rhdh-start.yaml references ConfigMaps/Secrets
  # created by apply_yaml_files(), which this disconnected handler skips).
  oc create configmap app-config-rhdh-disconnected-smoke \
    --from-file="app-config-rhdh.yaml=${DIR}/resources/config_map/app-config-rhdh-disconnected-smoke.yaml" \
    --namespace="${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create app-config ConfigMap — aborting"
    return 1
  }

  local rendered_cr
  local auth_secret="${RELEASE_NAME}-dynamic-plugins-registry-auth"
  rendered_cr=$(envsubst < "${DIR}/resources/rhdh-operator/rhdh-start-disconnected-smoke.yaml")
  # Parity with helm-post-renderer.sh: registries.conf, policy.json, mirror CA.
  # Also mount registry auth.json for authenticated mirror pulls.
  # CI yq is mikefarah/yq (no --arg); interpolate paths via the shell.
  # shellcheck disable=SC2016
  # Auth: operator secret mounts use subPath and require an existing parent dir.
  # /opt/app-root/src/.config/containers is missing in the image, so mount to
  # /tmp and point REGISTRY_AUTH_FILE at it (skopeo honors that).
  rendered_cr=$(echo "$rendered_cr" | yq eval "
    .spec.application.extraEnvs.envs += [
      {
        \"name\": \"REGISTRY_AUTH_FILE\",
        \"value\": \"/tmp/auth.json\",
        \"containers\": [\"install-dynamic-plugins\"]
      }
    ] |
    .spec.application.extraFiles.configMaps = [
      {
        \"name\": \"rhdh-plugin-mirror-conf\",
        \"key\": \"rhdh-registries.conf\",
        \"mountPath\": \"/etc/containers/registries.conf.d\",
        \"containers\": [\"install-dynamic-plugins\"]
      },
      {
        \"name\": \"rhdh-plugin-mirror-policy\",
        \"key\": \"policy.json\",
        \"mountPath\": \"/etc/containers\",
        \"containers\": [\"install-dynamic-plugins\"]
      },
      {
        \"name\": \"mirror-registry-ca\",
        \"key\": \"ca.crt\",
        \"mountPath\": \"/etc/containers/certs.d/${MIRROR_REGISTRY_URL}\",
        \"containers\": [\"install-dynamic-plugins\"]
      }
    ] |
    .spec.application.extraFiles.secrets = [
      {
        \"name\": \"${auth_secret}\",
        \"key\": \"auth.json\",
        \"mountPath\": \"/tmp\",
        \"containers\": [\"install-dynamic-plugins\"]
      }
    ]
  " -)

  local cr_temp="${DISCONNECTED_TMPDIR}/backstage-cr-disconnected.yaml"
  echo "$rendered_cr" > "${cr_temp}"

  cp "${cr_temp}" "${ARTIFACT_DIR}/disconnected-backstage-cr.yaml" 2> /dev/null || true

  # Re-assert RELATED_IMAGE in case OLM v1 reconciled the operator Deployment
  # back to the CSV GA value while we prepared the namespace.
  disconnected::set_operator_related_hub_image "rhdh-operator" || return 1

  deploy_rhdh_operator "${NAME_SPACE}" "${cr_temp}"
  log::success "Backstage CR deployed in ${NAME_SPACE}"

  # CR deployment.patch sets both images, but the operator re-applies
  # RELATED_IMAGE_backstage onto install-dynamic-plugins after the merge
  # (backend patch sticks; init does not). RELATED_IMAGE was set above; also
  # force-patch the live Deployment before smoke wait in case the first
  # reconcile raced the operator rollout.
  disconnected::patch_backstage_hub_images "${NAME_SPACE}" || return 1

  log::section "Smoke Test"

  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Operator smoke test completed"
}
