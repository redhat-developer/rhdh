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
  # --index-image (OLM operator catalog). Used only for mirror-plugins.sh below,
  # then cleared so deploy does not inject :next defaults onto the GA hub.
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

  # Smoke CR sets CATALOG_INDEX_IMAGE="" to clear the hub profile default digest
  # (unset alone leaves a baked-in digest that is not on the mirror). Do not
  # inject plugin-catalog-index:next: 1.11/next defaults reference the missing
  # quay.io/rhdh/...-plugin-homepage image (RHDHBUGS-3515). Homepage comes from
  # the OCI dynamic-home-page ConfigMap instead.
  # Clear any CI-provided CATALOG_INDEX_IMAGE so deploy_rhdh_operator does not
  # yq-inject a non-empty value over the CR empty env.
  unset CATALOG_INDEX_IMAGE
  log::info "CATALOG_INDEX_IMAGE unset in env; smoke CR clears init catalog extraction"

  disconnected::resolve_homepage_plugin_package || return 1

  log::section "Namespace and Secrets"

  namespace::configure "${NAME_SPACE}"
  disconnected::apply_plugin_mirror_configmap "${NAME_SPACE}" || return 1
  # Same CA/auth secrets as Helm so skopeo in install-dynamic-plugins can pull
  # from the mirror (registries.conf alone is not enough — TLS verify fails).
  disconnected::create_mirror_registry_ca_configmap "${NAME_SPACE}" || return 1
  disconnected::create_plugin_registry_auth_secret "${NAME_SPACE}" || return 1
  disconnected::create_homepage_plugins_configmap "${NAME_SPACE}" || return 1

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
  # Parity with helm-post-renderer.sh / air-gapped Operator docs: registries.conf,
  # policy.json, mirror CA on install-dynamic-plugins only. Also mount registry
  # auth.json for authenticated mirror pulls.
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

  deploy_rhdh_operator "${NAME_SPACE}" "${cr_temp}"
  log::success "Backstage CR deployed in ${NAME_SPACE}"

  log::section "Smoke Test"

  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Operator smoke test completed"
}
