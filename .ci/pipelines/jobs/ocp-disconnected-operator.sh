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

  common::oc_login

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::setup_local_ocp_mirror || return 1
  fi

  disconnected::require_env
  disconnected::setup_auth

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  # Uses prepare-restricted-environment.sh from rhdh-operator, which handles
  # mirroring operator/operand images and installing the operator CatalogSource.
  log::section "Operator Mirroring and Installation"

  # Fetch prepare-restricted-environment.sh from RELEASE_BRANCH_NAME (default
  # main). rhdh-operator#3259 (native oc-mirror cc-* catalogs for OLM v1) is
  # merged on main.
  local prepare_script_path="${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh"
  disconnected::fetch_operator_repo_script "prepare-restricted-environment.sh" \
    "${prepare_script_path}" || {
    log::error "Failed to fetch prepare-restricted-environment.sh — aborting"
    return 1
  }

  # Use oc-mirror (documented air-gapped OCP path) instead of the script's
  # default skopeo/umoci/podman-build path. Nested Podman in this CI pod cannot
  # initialize storage (newuidmap / VFS chown both fail under hostUsers: false).
  # CATALOG_INDEX_IMAGE is the plugin catalog index — do not pass it as
  # --index-image (OLM operator catalog). It is consumed by mirror-plugins.sh and
  # injected into the Backstage CR by deploy_rhdh_operator.
  #
  # OLM version: leave default (auto). On OCP 4.21+ this selects OLM v1.
  local filter_versions="${RELEASE_VERSION}"
  if [[ "${filter_versions}" == "next" || "${filter_versions}" == "*" ]]; then
    filter_versions="*"
  fi

  # Mirroring every historical RHDH operator version (* / next) is unnecessary
  # for smoke and flakes on quay CDN EOF (CI) or overwhelms the integrated
  # registry (local). Pin to the chart major.minor (e.g. 2.0-80-CI → 2.0).
  if [[ "${filter_versions}" == "*" ]]; then
    local chart_mm=""
    if [[ -n "${CHART_VERSION:-}" && "${CHART_VERSION}" =~ ^([0-9]+\.[0-9]+) ]]; then
      chart_mm="${BASH_REMATCH[1]}"
    fi
    if [[ -z "${chart_mm}" ]]; then
      log::error "Cannot derive --filter-versions from CHART_VERSION='${CHART_VERSION:-unset}'; expected major.minor prefix (e.g. 2.0-80-CI)"
      return 1
    fi
    filter_versions="${chart_mm}"
    log::info "filter-versions=${filter_versions} (from CHART_VERSION=${CHART_VERSION})"
  fi

  # CONTAINER_PLATFORM_VERSION is set by e2e-tests/container-init.sh from the
  # live cluster (oc version → major.minor).
  local ocp_version="${CONTAINER_PLATFORM_VERSION:-}"
  if [[ -z "${ocp_version}" || "${ocp_version}" == "unknown" || ! "${ocp_version}" =~ ^[0-9]+\.[0-9]+$ ]]; then
    log::error "CONTAINER_PLATFORM_VERSION is unset or invalid ('${ocp_version}'); expected OpenShift major.minor"
    return 1
  fi
  # GA/RC verification mirrors the published Red Hat Operator catalog, the only
  # one carrying released bundles. A filtered oc-mirror run rejects it until the
  # rhdh-operator defaultChannel fix lands (rhdh-operator#3822). CI runs
  # (IMAGE_REGISTRY=quay.io) cannot use it at all: it has no 2.x bundles, so they
  # mirror the RHDH CI catalog built from the same commit as the hub image.
  local index_image=""
  local registries_conf=""
  if [[ "${IMAGE_REGISTRY}" == "registry.redhat.io" ]]; then
    index_image="registry.redhat.io/redhat/redhat-operator-index:v${ocp_version}"
  else
    # rhdh-operator publishes one catalog per release stream and OCP minor,
    # e.g. quay.io/rhdh/iib:next-v4.21-x86_64 (amd64 only; the jobs run on
    # amd64 clusters).
    index_image="quay.io/rhdh/iib:${RELEASE_VERSION}-v${ocp_version}-x86_64"
    skopeo inspect --raw "docker://${index_image}" > /dev/null || {
      log::error "RHDH CI operator catalog ${index_image} not found or unreadable"
      return 1
    }

    # The CI bundle's RELATED_IMAGE refs point at registry.redhat.io/rhdh/*
    # (plus the stage/access aliases), whose digests exist on quay.io/rhdh only.
    # Rewrite those pulls for the oc-mirror run with containers/image
    # registries.conf (CONTAINERS_REGISTRIES_CONF), the same mechanism the
    # medik8s-disconnected-catalogsource CI step uses. Images in other
    # repositories (e.g. registry.redhat.io/rhel10/postgresql-18) keep their
    # original source and are pulled with the CI credentials.
    registries_conf="${DISCONNECTED_TMPDIR}/oc-mirror-registries.conf"
    cat > "${registries_conf}" << 'EOF'
[[registry]]
prefix = "registry.redhat.io/rhdh"
location = "quay.io/rhdh"

[[registry]]
prefix = "registry.stage.redhat.io/rhdh"
location = "quay.io/rhdh"

[[registry]]
prefix = "registry.access.redhat.com/rhdh"
location = "quay.io/rhdh"
EOF
  fi
  log::info "Using OCP ${ocp_version} (CONTAINER_PLATFORM_VERSION); index image ${index_image}"

  # Local connected OCP: OCP_INTERNAL sentinel (same as omit-on-OCP). CI bastion
  # keeps the external MIRROR_REGISTRY_URL. Route URL stays in MIRROR_REGISTRY_URL
  # for mirror-plugins / registries.conf mounts.
  local to_registry="${MIRROR_REGISTRY_URL}"
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    to_registry="OCP_INTERNAL"
    log::info "LOCAL_DISCONNECTED=1: prepare --to-registry OCP_INTERNAL"
  fi

  local prepare_args=(
    --use-oc-mirror true
    --to-registry "${to_registry}"
    --index-image "${index_image}"
    --filter-versions "${filter_versions}"
  )

  # OCP integrated registry rejects cosign/sigstore .sig attachments
  # ("writing signatures: ... name unknown"). Same as disconnected::run_oc_mirror.
  # CI bastion external mirrors keep prepare's default oc-mirror flags.
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    prepare_args+=(--oc-mirror-flags "--remove-signatures")
    log::info "LOCAL_DISCONNECTED=1: prepare --oc-mirror-flags --remove-signatures"
  fi

  # prepare-restricted-environment.sh skips OLM v1 pull-secret/CA setup for
  # external registries. Catalogd must trust the mirror CA and authenticate
  # before ClusterCatalog can reach Serving=True. Skip on LOCAL_DISCONNECTED —
  # OCP_INTERNAL path configures internal registry trust itself.
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    disconnected::ensure_olm_mirror_pull_secret || return 1
    disconnected::ensure_mirror_registry_ca || return 1
    disconnected::wait_mcp_updated
  else
    log::info "LOCAL_DISCONNECTED=1: skipping external bastion CA/pull-secret pre-prepare helpers"
  fi

  local -a prepare_cmd=(bash "${prepare_script_path}" "${prepare_args[@]}")
  if [[ -n "${registries_conf}" ]]; then
    # Scoped to this call: CATALOG_INDEX_IMAGE and the plugin pulls keep their
    # own registry configuration.
    prepare_cmd=(env CONTAINERS_REGISTRIES_CONF="${registries_conf}" "${prepare_cmd[@]}")
    log::info "Redirecting registry.redhat.io/rhdh to quay.io/rhdh via ${registries_conf}"
  fi

  log::info "Running prepare-restricted-environment.sh with: ${prepare_args[*]}"
  if ! disconnected::retry_on_local_registry 5 \
    disconnected::with_unset_registry_auth_file \
    "${prepare_cmd[@]}"; then
    log::error "prepare-restricted-environment.sh failed — aborting"
    return 1
  fi
  log::success "Operator installed via prepare-restricted-environment.sh"

  # prepare patches the operator SA with internal-registry secret names that do
  # not exist for an external mirror. Provide a real mirror pull secret and
  # attach it to the OLM v1 installer SA used by ClusterExtension.
  # Skip on LOCAL_DISCONNECTED — OCP_INTERNAL uses cluster-internal pull secrets.
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
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
  else
    log::info "LOCAL_DISCONNECTED=1: skipping reg-pull-secret SA patch"
    # OCP_INTERNAL: grant catalogd/operator-controller pull on oc-mirror and
    # rewrite route-based IDMS → in-cluster registry service (else Serving never
    # becomes True → Backstage CRD timeout).
    disconnected::ensure_local_ocp_internal_olm_access || return 1
  fi

  # prepare-restricted-environment.sh applies IDMS/CatalogSource which triggers
  # a MachineConfig update and node rolling. Wait for completion before deploying
  # workloads, same as the Helm path.
  disconnected::wait_mcp_updated

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    # Catalogd needs the registry + image-puller grants above before Serving=True.
    log::info "Waiting for ClusterCatalog/rhdh-catalog Serving=True (LOCAL_DISCONNECTED)..."
    local catalog_wait=0
    until [[ "$(oc get clustercatalog rhdh-catalog -o jsonpath='{.status.conditions[?(@.type=="Serving")].status}' 2> /dev/null || true)" == "True" ]]; do
      if ((catalog_wait >= 600)); then
        log::error "ClusterCatalog/rhdh-catalog did not become Serving=True within 600s"
        disconnected::dump_olm_v1_status "rhdh-operator"
        return 1
      fi
      sleep 15
      catalog_wait=$((catalog_wait + 15))
    done
    log::success "ClusterCatalog/rhdh-catalog is Serving=True"
  fi

  # prepare only creates the ClusterExtension; wait until OLM v1 installs the
  # operator and the Backstage CRD appears (dump status on timeout).
  disconnected::wait_operator_crd_olm_v1 "rhdh-operator" "backstages.rhdh.redhat.com" 600 || {
    log::error "Backstage CRD not available after operator installation"
    return 1
  }

  log::section "Plugin Mirroring"
  # Both CI and LOCAL_DISCONNECTED consume CATALOG_INDEX_IMAGE (the shared env
  # contract from env_variables.sh, derived from RELEASE_VERSION when unset).
  disconnected::mirror_plugins || return 1

  # Pin CATALOG_INDEX_IMAGE to the digest actually pushed (hub profile default
  # digest is often absent from the mirror). mirror_plugins exported the
  # digest-pinned OCI package for each smoke plugin (ref:// cannot resolve with
  # includes: []).
  disconnected::resolve_catalog_index_image || return 1

  log::section "Namespace and Secrets"

  namespace::configure "${NAME_SPACE}"
  disconnected::allow_mirror_registry_egress "${NAME_SPACE}" || return 1
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::ensure_local_image_pull_access "${NAME_SPACE}" || return 1
  fi
  disconnected::apply_plugin_mirror_configmap "${NAME_SPACE}" || return 1
  # Same CA/auth secrets as Helm so skopeo in install-dynamic-plugins can pull
  # from the mirror (registries.conf alone is not enough — TLS verify fails).
  disconnected::create_mirror_registry_ca_configmap "${NAME_SPACE}" || return 1
  disconnected::create_plugin_registry_auth_secret "${NAME_SPACE}" || return 1
  disconnected::create_smoke_plugins_configmap "${NAME_SPACE}" || return 1

  # Operator mounts one volume per extraFiles ConfigMap name. policy.json cannot
  # share rhdh-plugin-mirror-conf or reconcile fails with duplicate volume keys.
  oc create configmap rhdh-plugin-mirror-policy \
    --from-file=policy.json="${DIR}/resources/disconnected/policy.json" \
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
    --from-file="app-config-rhdh.yaml=${DIR}/resources/disconnected/app-config-rhdh-disconnected-smoke.yaml" \
    --namespace="${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create app-config ConfigMap — aborting"
    return 1
  }

  # Backstage CR template includes extraFiles/extraEnvs for disconnected mounts
  # (registries.conf, policy.json, mirror CA, auth.json).
  local cr_temp="${DISCONNECTED_TMPDIR}/backstage-cr-disconnected.yaml"
  envsubst < "${DIR}/resources/rhdh-operator/rhdh-start-disconnected-smoke.yaml" > "${cr_temp}"

  cp "${cr_temp}" "${ARTIFACT_DIR}/disconnected-backstage-cr.yaml" 2> /dev/null || true

  deploy_rhdh_operator "${NAME_SPACE}" "${cr_temp}"
  log::success "Backstage CR deployed in ${NAME_SPACE}"

  log::section "Smoke Test"

  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Operator smoke test completed"
}
