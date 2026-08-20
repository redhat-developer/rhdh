#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/disconnected.sh
source "$DIR"/lib/disconnected.sh

export INSTALL_METHOD="helm"

handle_ocp_disconnected_helm() {
  # Force a dedicated namespace (env_variables.sh may already set NAME_SPACE=showcase).
  export NAME_SPACE="showcase-ci-disconnected"

  common::oc_login

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::setup_local_ocp_mirror || return 1
  fi

  disconnected::require_env
  disconnected::setup_auth

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  log::section "Chart Resolution"

  local is_ga="false"
  if [[ "${IMAGE_REGISTRY}" == "registry.redhat.io" ]]; then
    is_ga="true"
  fi

  if [[ "${is_ga}" == "true" ]]; then
    helm repo add openshift-helm-charts https://charts.openshift.io 2> /dev/null || true
    helm repo update openshift-helm-charts
    log::info "Pulling GA chart from charts.openshift.io (version: ${RELEASE_VERSION})"
    helm pull openshift-helm-charts/redhat-developer-hub \
      --version "${RELEASE_VERSION}" \
      -d "${DISCONNECTED_TMPDIR}" || {
      log::error "Failed to pull chart from charts.openshift.io"
      return 1
    }
  else
    log::info "Pulling CI chart from ${HELM_CHART_URL} (version: ${CHART_VERSION})"
    helm pull "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
      -d "${DISCONNECTED_TMPDIR}" || {
      log::error "Failed to pull chart from ${HELM_CHART_URL}"
      return 1
    }
  fi

  CHART_LOCAL_TGZ=$(find "${DISCONNECTED_TMPDIR}" -maxdepth 1 -name '*.tgz' | head -1)
  export CHART_LOCAL_TGZ

  if [[ -z "${CHART_LOCAL_TGZ}" ]]; then
    log::error "No chart .tgz found in ${DISCONNECTED_TMPDIR}"
    return 1
  fi
  log::success "Chart pulled: ${CHART_LOCAL_TGZ}"

  # Resolve PostgreSQL image from chart values
  local helm_values
  helm_values=$(helm show values "${CHART_LOCAL_TGZ}" 2> /dev/null || true)

  # `// ""` coalesces a missing key (yq prints literal "null") to empty so the
  # ${:-default} fallback below actually applies.
  export PG_REGISTRY PG_REPO PG_TAG PG_SEPARATOR
  PG_REGISTRY=$(echo "${helm_values}" | yq '.upstream.postgresql.image.registry // ""' || true)
  PG_REPO=$(echo "${helm_values}" | yq '.upstream.postgresql.image.repository // ""' || true)
  PG_TAG=$(echo "${helm_values}" | yq '.upstream.postgresql.image.tag // ""' || true)
  PG_REGISTRY="${PG_REGISTRY:-${POSTGRESQL_IMAGE_REGISTRY}}"
  PG_REPO="${PG_REPO:-${POSTGRESQL_IMAGE_REPO}}"
  PG_TAG="${PG_TAG:-${POSTGRESQL_IMAGE_TAG}}"

  # The chart encodes digest refs as repository: "repo@sha256" + tag: "<hash>".
  # Normalize: extract the digest qualifier into PG_SEPARATOR so that:
  #   - PG_REPO is always a clean path (usable in IDMS source/mirror fields)
  #   - Full ref is ${PG_REGISTRY}/${PG_REPO}${PG_SEPARATOR}${PG_TAG}
  PG_SEPARATOR=":"
  if [[ "${PG_REPO}" == *"@"* ]]; then
    PG_SEPARATOR="@${PG_REPO##*@}:" # e.g., "@sha256:"
    PG_REPO="${PG_REPO%@*}"         # e.g., "rhel9/postgresql-15"
  fi

  log::info "PostgreSQL image from chart: ${PG_REGISTRY}/${PG_REPO}${PG_SEPARATOR}${PG_TAG}"

  # Catalog index is no longer derived from chart values: both CI and
  # LOCAL_DISCONNECTED consume CATALOG_INDEX_IMAGE (the shared env contract in
  # env_variables.sh, pinned via CATALOG_INDEX_IMAGE_OVERRIDE). It is mirrored by
  # build_imageset_config (mirror.sh additionalImages) and later re-pinned to the
  # mirrored digest by resolve_catalog_index_image.
  log::info "Catalog index (env contract): ${CATALOG_INDEX_IMAGE:-<unset>}"

  echo "${helm_values}" > "${ARTIFACT_DIR}/disconnected-helm-chart-values.yaml" 2> /dev/null || true

  log::section "Image Mirroring"

  local imageset_config="${DISCONNECTED_TMPDIR}/imageset-config.yaml"
  disconnected::build_imageset_config "${imageset_config}" || {
    log::error "Failed to build ImageSetConfiguration"
    return 1
  }

  local workspace="${DISCONNECTED_TMPDIR}/oc-mirror-workspace"
  disconnected::run_oc_mirror "${imageset_config}" "${workspace}" || {
    log::error "oc-mirror failed — aborting"
    return 1
  }

  log::section "Cluster Resources"

  disconnected::patch_idms "${OC_MIRROR_IDMS_FILE}"

  oc apply -f "${OC_MIRROR_IDMS_FILE}" || {
    log::error "Failed to apply IDMS — aborting"
    return 1
  }
  log::success "ImageDigestMirrorSet applied"

  if [[ -n "${OC_MIRROR_ITMS_FILE:-}" ]]; then
    oc apply -f "${OC_MIRROR_ITMS_FILE}" || {
      log::error "Failed to apply ITMS — aborting"
      return 1
    }
    log::success "ImageTagMirrorSet applied"
  fi

  # IDMS/ITMS changes trigger a MachineConfig update which rolls worker nodes
  # (drain → apply config → reboot). Wait for all MachineConfigPools to finish
  # before deploying workloads, otherwise pods get evicted mid-startup.
  disconnected::wait_mcp_updated

  log::section "Plugin Mirroring"
  disconnected::mirror_plugins || return 1
  # Same digest-pinned homepage OCI plugin as Operator (includes: [] skips
  # catalog defaults). Helm consumes it via global.dynamic values overlay.
  # Resolve homepage first: it reads CATALOG_INDEX_IMAGE in its pre-mirror
  # source form, which resolve_catalog_index_image overwrites below.
  disconnected::resolve_homepage_plugin_package || return 1
  disconnected::resolve_catalog_index_image || return 1

  log::section "Namespace and Secrets"

  namespace::configure "${NAME_SPACE}"
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::ensure_local_image_pull_access "${NAME_SPACE}" || return 1
  fi
  disconnected::apply_plugin_mirror_configmap "${NAME_SPACE}" || return 1

  # Mirror CA + registry auth for install-dynamic-plugins (skopeo).
  # Post-renderer mounts CA at /etc/containers/certs.d/<registry>/ca.crt;
  # the chart mounts ${RELEASE_NAME}-dynamic-plugins-registry-auth at
  # /opt/app-root/src/.config/containers.
  disconnected::create_mirror_registry_ca_configmap "${NAME_SPACE}" || return 1
  disconnected::create_plugin_registry_auth_secret "${NAME_SPACE}" || return 1

  log::section "Helm Deployment"

  # Prefer the chart from oc-mirror workspace, fall back to the pulled tgz
  local chart_install_path
  chart_install_path="${OC_MIRROR_CHART_PATH:-${CHART_LOCAL_TGZ}}"
  log::info "Installing chart from: ${chart_install_path}"

  # LOCAL_DISCONNECTED: kubelet pulls via in-cluster registry service; route URL
  # is only for oc-mirror/skopeo push and plugin registries.conf + CA mounts.
  local image_registry
  image_registry=$(disconnected::cluster_mirror_host)
  log::info "Helm image registry: ${image_registry}"

  local helm_set_flags=(
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}"
    --set upstream.postgresql.image.registry="${image_registry}"
  )

  # Shared image params (helm::get_image_params), with disconnected overrides:
  #   - backstage image registry -> in-cluster mirror host (kubelet pull)
  #   - catalog index registry   -> MIRROR_REGISTRY_URL. The index is pulled by
  #     skopeo in install-dynamic-plugins (route CA + auth.json), not kubelet;
  #     the in-cluster service CA is not mounted into certs.d and fails x509.
  #   - LOCAL_DISCONNECTED omits the hub image so the chart + IDMS resolve it
  #     (not ${IMAGE_REPO}:${TAG_NAME}).
  local image_param_opts=(--backstage-registry "${image_registry}" --catalog-registry "${MIRROR_REGISTRY_URL}")
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    log::info "LOCAL_DISCONNECTED: Helm hub image from chart + IDMS (not ${IMAGE_REPO}:${TAG_NAME})"
    image_param_opts+=(--omit-backstage-image)
  fi

  local image_params
  image_params=$(helm::get_image_params "${image_param_opts[@]}") || return 1
  # get_image_params returns a space-separated --set string; split into the array
  # (values never contain spaces).
  local -a image_param_flags
  read -r -a image_param_flags <<< "${image_params}"
  helm_set_flags+=("${image_param_flags[@]}")

  # Post-renderer appends disconnected volumes (registries.conf, mirror CA)
  # to the rendered Deployment, avoiding the Helm "array clobber" pitfall.
  local post_renderer="${DIR}/resources/disconnected/helm-post-renderer.sh"
  local homepage_values="${DISCONNECTED_TMPDIR}/values-homepage.yaml"
  disconnected::write_homepage_helm_values "${homepage_values}" || return 1

  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${chart_install_path}" \
    -f "${DIR}/value_files/values_disconnected-smoke.yaml" \
    -f "${homepage_values}" \
    --post-renderer "${post_renderer}" \
    --post-renderer-args "${MIRROR_REGISTRY_URL}" \
    "${helm_set_flags[@]}" || {
    log::error "Helm deployment failed"
    return 1
  }

  log::success "RHDH deployed via Helm with mirrored images"

  printf '%s\n' "${helm_set_flags[@]}" > "${ARTIFACT_DIR}/disconnected-helm-set-flags.txt" 2> /dev/null || true

  # Hub can start during first-boot Postgres initdb, fail plugin init, and
  # stay not-ready (liveness 200). Bounce only if still not Available.
  disconnected::ensure_helm_hub_after_postgres "${NAME_SPACE}" "${RELEASE_NAME}" || return 1

  log::section "Smoke Test"

  if [[ -n "${HTTPS_PROXY:-}" ]]; then
    log::info "HTTPS_PROXY is set (Playwright will use it): ${HTTPS_PROXY%%@*}@***"
  fi

  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  # 40 x 30s = 20 min: covers the worst-case AWS EBS CSI volume re-attach
  # delay (~5 min, see disconnected::ensure_helm_hub_after_postgres) plus
  # normal disconnected plugin-init time (default window is 15 min).
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}" 40 30

  log::success "Disconnected Helm smoke test completed"
}
