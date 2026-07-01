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
  export NAME_SPACE="${NAME_SPACE:-showcase-ci-disconnected}"

  disconnected::require_env
  disconnected::setup_auth

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  # --- Section A: Install oc-mirror ---
  log::section "oc-mirror Setup"

  disconnected::install_oc_mirror || {
    log::error "Failed to install oc-mirror — aborting"
    return 1
  }

  # --- Section B: Resolve chart source and pull locally ---
  log::section "Chart Resolution"

  local is_ga="false"
  if [[ "${IMAGE_REGISTRY}" == "registry.redhat.io" ]]; then
    is_ga="true"
  fi

  if [[ "${is_ga}" == "true" ]]; then
    # GA: pull chart from charts.openshift.io
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
    # CI/upstream: pull chart from OCI registry
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

  # --- Section C: Resolve PostgreSQL image from chart ---
  local helm_values
  helm_values=$(helm show values "${CHART_LOCAL_TGZ}" 2> /dev/null || true)

  export PG_REGISTRY PG_REPO PG_TAG PG_SEPARATOR
  PG_REGISTRY=$(echo "${helm_values}" | yq '.upstream.postgresql.image.registry' || true)
  PG_REPO=$(echo "${helm_values}" | yq '.upstream.postgresql.image.repository' || true)
  PG_TAG=$(echo "${helm_values}" | yq '.upstream.postgresql.image.tag' || true)
  PG_REGISTRY="${PG_REGISTRY:-registry.redhat.io}"
  PG_REPO="${PG_REPO:-rhel9/postgresql-15}"
  PG_TAG="${PG_TAG:-latest}"

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

  echo "${helm_values}" > "${ARTIFACT_DIR}/disconnected-helm-chart-values.yaml" 2> /dev/null || true

  # --- Section D: Build ImageSetConfiguration ---
  log::section "Image Mirroring"

  local imageset_config="${DISCONNECTED_TMPDIR}/imageset-config.yaml"
  disconnected::build_imageset_config "${imageset_config}" || {
    log::error "Failed to build ImageSetConfiguration"
    return 1
  }

  # --- Section E: Run oc-mirror ---
  local workspace="${DISCONNECTED_TMPDIR}/oc-mirror-workspace"
  disconnected::run_oc_mirror "${imageset_config}" "${workspace}" || {
    log::error "oc-mirror failed — aborting"
    return 1
  }

  # --- Section F: Patch and apply IDMS ---
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

  # --- Section G: Plugin mirroring ---
  log::section "Plugin Mirroring"

  disconnected::fetch_script "mirror-plugins.sh" "${DISCONNECTED_TMPDIR}/mirror-plugins.sh" || {
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

  # --- Section H: Namespace + registries.conf ConfigMap ---
  namespace::configure "${NAME_SPACE}"

  envsubst < "${DIR}/resources/disconnected/plugin-mirror-configmap.yaml" \
    | oc apply -n "${NAME_SPACE}" -f - || {
    log::error "Failed to create registries.conf ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-conf created in ${NAME_SPACE}"

  envsubst < "${DIR}/resources/disconnected/plugin-mirror-configmap.yaml" \
    > "${ARTIFACT_DIR}/disconnected-plugin-mirror-configmap.yaml" 2> /dev/null || true

  # Mirror registry CA — mounted at /etc/containers/certs.d/<registry>/ca.crt
  # inside the init container so skopeo trusts the mirror when IDMS redirects
  # quay.io/registry.redhat.io pulls. Uses the standard container-tools
  # per-registry CA mechanism; no system trust store replacement needed.
  oc create configmap mirror-registry-ca \
    --from-file="ca.crt=${MIRROR_REGISTRY_CA}" \
    -n "${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create mirror-registry-ca ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap mirror-registry-ca created in ${NAME_SPACE}"

  # Registry auth for the init container — the chart mounts
  # ${RELEASE_NAME}-dynamic-plugins-registry-auth at
  # /opt/app-root/src/.config/containers (containers auth.json path).
  oc create secret generic "${RELEASE_NAME}-dynamic-plugins-registry-auth" \
    --from-file="auth.json=${MIRROR_REGISTRY_PULL_SECRET}" \
    -n "${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create registry auth secret — aborting"
    return 1
  }
  log::success "Secret ${RELEASE_NAME}-dynamic-plugins-registry-auth created in ${NAME_SPACE}"

  # --- Section I: Helm deployment from mirrored chart ---
  log::section "Helm Deployment"

  # Prefer the chart from oc-mirror workspace, fall back to the pulled tgz
  local chart_install_path
  chart_install_path="${OC_MIRROR_CHART_PATH:-${CHART_LOCAL_TGZ}}"
  log::info "Installing chart from: ${chart_install_path}"

  local helm_set_flags=(
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}"
    --set upstream.backstage.image.registry="${MIRROR_REGISTRY_URL}"
    --set upstream.backstage.image.repository="${IMAGE_REPO}"
    --set upstream.backstage.image.tag="${TAG_NAME}"
    --set upstream.postgresql.image.registry="${MIRROR_REGISTRY_URL}"
  )

  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    helm_set_flags+=(
      --set global.catalogIndex.image.registry="${MIRROR_REGISTRY_URL}"
      --set global.catalogIndex.image.repository="${CATALOG_INDEX_REPO}"
      --set global.catalogIndex.image.tag="${CATALOG_INDEX_TAG}"
    )
  fi

  # Post-renderer appends registries.conf volume + mount to the rendered
  # Deployment, avoiding the Helm "array clobber" pitfall where a values
  # file that defines extraVolumes[] replaces the chart's entire default
  # array (which grows across chart versions).
  local post_renderer="${DIR}/resources/disconnected/helm-post-renderer.sh"

  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${chart_install_path}" \
    -f "${DIR}/value_files/values_disconnected-smoke.yaml" \
    --post-renderer "${post_renderer}" \
    --post-renderer-args "${MIRROR_REGISTRY_URL}" \
    "${helm_set_flags[@]}" || {
    log::error "Helm deployment failed"
    return 1
  }

  log::success "RHDH deployed via Helm with mirrored images"

  printf '%s\n' "${helm_set_flags[@]}" > "${ARTIFACT_DIR}/disconnected-helm-set-flags.txt" 2> /dev/null || true

  # --- Section J: Smoke test ---
  log::section "Smoke Test"

  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Helm smoke test completed"
}
