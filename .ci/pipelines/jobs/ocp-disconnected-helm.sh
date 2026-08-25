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

  export PG_REGISTRY PG_REPO PG_TAG PG_SEPARATOR
  PG_REGISTRY=$(echo "${helm_values}" | yq '.upstream.postgresql.image.registry' || true)
  PG_REPO=$(echo "${helm_values}" | yq '.upstream.postgresql.image.repository' || true)
  PG_TAG=$(echo "${helm_values}" | yq '.upstream.postgresql.image.tag' || true)
  PG_REGISTRY="${PG_REGISTRY:-registry.redhat.io}"
  PG_REPO="${PG_REPO:-rhel9/postgresql-15}"
  PG_TAG="${PG_TAG:-latest}"

  PG_SEPARATOR=":"
  common::normalize_chart_image_ref PG_REPO PG_TAG PG_SEPARATOR

  log::info "PostgreSQL image from chart: ${PG_REGISTRY}/${PG_REPO}${PG_SEPARATOR}${PG_TAG}"

  # LOCAL_DISCONNECTED: chart-pin catalog digest before mirror (env may set :next).
  disconnected::pin_local_catalog_index_from_chart || return 1
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

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    log::info "LOCAL_DISCONNECTED: Helm hub image from chart + IDMS (not ${IMAGE_REPO}:${TAG_NAME})"
  else
    helm_set_flags+=(
      --set upstream.backstage.image.registry="${image_registry}"
      --set upstream.backstage.image.repository="${IMAGE_REPO}"
      --set upstream.backstage.image.tag="${TAG_NAME}"
    )
  fi

  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    # Catalog index is pulled by skopeo in install-dynamic-plugins (route CA +
    # auth.json), not by kubelet. Keep it on MIRROR_REGISTRY_URL; the in-cluster
    # service CA is not mounted into certs.d and fails x509 verify.
    helm_set_flags+=(
      --set global.catalogIndex.image.registry="${MIRROR_REGISTRY_URL}"
      --set global.catalogIndex.image.repository="${CATALOG_INDEX_REPO}"
      --set global.catalogIndex.image.tag="${CATALOG_INDEX_TAG}"
    )
  fi

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
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Helm smoke test completed"
}
