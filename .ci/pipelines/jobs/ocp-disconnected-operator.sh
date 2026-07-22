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

  # TEMPORARY: pin prepare-restricted-environment.sh to rhdh-operator PR #3259
  # (https://github.com/redhat-developer/rhdh-operator/pull/3259) so oc-mirror
  # + OLM v1 uses native cc-*.yaml catalogs and skips re-applying a synthetic
  # clusterCatalog.yaml that is missing on main. Revert to
  # disconnected::fetch_script once that PR merges.
  local prepare_script_sha="0f0db074a3504bf61ff2cfbbc90a8089c4723822"
  local prepare_script_path="${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh"
  local prepare_script_url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/${prepare_script_sha}/.rhdh/scripts/prepare-restricted-environment.sh"
  log::info "Fetching prepare-restricted-environment.sh from rhdh-operator@${prepare_script_sha} (temporary pin for PR #3259)..."
  if ! curl -fL --max-time 30 -o "${prepare_script_path}" "${prepare_script_url}"; then
    log::error "Failed to download prepare-restricted-environment.sh from ${prepare_script_url}"
    return 1
  fi
  chmod +x "${prepare_script_path}"
  log::success "Downloaded prepare-restricted-environment.sh to ${prepare_script_path}"

  # Use oc-mirror (documented air-gapped OCP path) instead of the script's
  # default skopeo/umoci/podman-build path. Nested Podman in this CI pod cannot
  # initialize storage (newuidmap / VFS chown both fail under hostUsers: false).
  # CATALOG_INDEX_IMAGE is the plugin catalog index — do not pass it as
  # --index-image (OLM operator catalog). Keep it for mirror-plugins.sh below.
  #
  # OLM version: leave default (auto). On OCP 4.21+ this selects OLM v1;
  # the temporary prepare-script pin above fixes the oc-mirror + v1 path.
  local filter_versions="${RELEASE_VERSION}"
  if [[ "${filter_versions}" == "next" || "${filter_versions}" == "*" ]]; then
    filter_versions="*"
  fi

  # Match redhat-operator-index major.minor to the live cluster (same pattern as
  # e2e-tests/container-init.sh CONTAINER_PLATFORM_VERSION).
  local ocp_version
  ocp_version=$(oc version --output json 2> /dev/null | jq -r '.openshiftVersion' | cut -d'.' -f1,2)
  if [[ -z "${ocp_version}" || "${ocp_version}" == "null" || ! "${ocp_version}" =~ ^[0-9]+\.[0-9]+$ ]]; then
    log::error "Failed to detect OpenShift major.minor version from 'oc version'"
    return 1
  fi
  local index_image="registry.redhat.io/redhat/redhat-operator-index:v${ocp_version}"
  log::info "Detected OCP ${ocp_version}; using index image ${index_image}"

  local prepare_args=(
    --use-oc-mirror true
    --to-registry "${MIRROR_REGISTRY_URL}"
    --index-image "${index_image}"
    --filter-versions "${filter_versions}"
  )

  # oc-mirror panics when REGISTRY_AUTH_FILE is set (distribution/distribution
  # treats it as storage driver config). Auth comes from
  # ${XDG_RUNTIME_DIR}/containers/auth.json via disconnected::setup_auth.
  local saved_registry_auth_file="${REGISTRY_AUTH_FILE:-}"
  unset REGISTRY_AUTH_FILE

  log::info "Running prepare-restricted-environment.sh with: ${prepare_args[*]}"
  if ! bash "${prepare_script_path}" "${prepare_args[@]}"; then
    [[ -n "${saved_registry_auth_file}" ]] && export REGISTRY_AUTH_FILE="${saved_registry_auth_file}"
    log::error "prepare-restricted-environment.sh failed — aborting"
    return 1
  fi

  if [[ -n "${saved_registry_auth_file}" ]]; then
    export REGISTRY_AUTH_FILE="${saved_registry_auth_file}"
  fi
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
  rendered_cr=$(envsubst < "${DIR}/resources/rhdh-operator/rhdh-start-disconnected-smoke.yaml")
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
