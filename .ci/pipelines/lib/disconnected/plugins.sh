#!/usr/bin/env bash

# Plugin mirroring, catalog index resolution, and homepage ConfigMap.

[[ -n "${_DISCONNECTED_PLUGINS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_PLUGINS_SOURCED=1

# ---------------------------------------------------------------------------
# Hooks — overridable by local.sh (or other consumers) to customise CI-only
# behaviour for local-disconnected or alternative registry setups.
# ---------------------------------------------------------------------------

# Called after mirror-plugins.sh completes and the summary is copied.
# Local override: calls ensure_local_plugin_imagestream_tags to re-push
# digest-mirrored plugins under explicit :sha256-<digest> tags so the
# integrated registry serves them through ImageStreams.
disconnected::_hook_post_mirror_plugins() { :; }

# Set CATALOG_INDEX_REPO / CATALOG_INDEX_TAG / CATALOG_INDEX_IMAGE from
# the resolved digest. Default (CI): use @sha256 pinning.
# Local override: use :sha256-<digest> ImageStream tag format.
disconnected::_hook_catalog_index_exports() {
  local name=$1 digest=$2
  export CATALOG_INDEX_REPO="rhdh/${name}@sha256"
  export CATALOG_INDEX_TAG="${digest#sha256:}"
  export CATALOG_INDEX_IMAGE="${CATALOG_INDEX_REGISTRY}/rhdh/${name}@${digest}"
}

# ---------------------------------------------------------------------------
# Shared catalog index source ref
# ---------------------------------------------------------------------------

# The (un-mirrored) OCI ref to pull the plugin catalog index from. Honors
# CATALOG_INDEX_IMAGE (Gangway / --catalog-index-image, or the env_variables.sh
# default quay.io/rhdh/plugin-catalog-index:${RELEASE_VERSION}); falls back to
# the product's registry.access.redhat.com ref for RELEASE_VERSION.
# Used by mirror_plugins. Call before disconnected::resolve_catalog_index_image,
# which overwrites CATALOG_INDEX_IMAGE with a canonical (mirror-consumption) form.
disconnected::_catalog_index_source_ref() {
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    echo "${CATALOG_INDEX_IMAGE}"
  else
    echo "registry.access.redhat.com/rhdh/plugin-catalog-index:${RELEASE_VERSION}"
  fi
}

# ---------------------------------------------------------------------------
# mirror_plugins — fetch and run mirror-plugins.sh against the mirror registry
# ---------------------------------------------------------------------------

# Uses CATALOG_INDEX_IMAGE when set; otherwise the GA plugin-catalog-index tag.
disconnected::mirror_plugins() {
  local mirror_script="${DISCONNECTED_TMPDIR}/mirror-plugins.sh"

  disconnected::fetch_operator_repo_script "mirror-plugins.sh" "${mirror_script}" || {
    log::error "Failed to fetch mirror-plugins.sh — aborting"
    return 1
  }

  local plugin_index
  plugin_index="oci://$(disconnected::_catalog_index_source_ref)"

  disconnected::wait_mirror_registry_route 300 || return 1
  bash "${mirror_script}" \
    --plugin-index "${plugin_index}" \
    --to-registry "${MIRROR_REGISTRY_URL}" || {
    log::error "mirror-plugins.sh failed — aborting"
    return 1
  }

  # mirror-plugins.sh writes the summary to ORIGINAL_DIR (pwd at script start).
  local summary_src
  summary_src="$(pwd)/rhdh-plugin-mirroring-summary.txt"
  if [[ ! -f "${summary_src}" ]]; then
    log::error "mirror-plugins.sh succeeded but summary not found at ${summary_src}"
    return 1
  fi
  cp "${summary_src}" "${DISCONNECTED_TMPDIR}/rhdh-plugin-mirroring-summary.txt" || {
    log::error "Failed to copy plugin mirroring summary to ${DISCONNECTED_TMPDIR}"
    return 1
  }
  cp "${summary_src}" "${ARTIFACT_DIR}/rhdh-plugin-mirroring-summary.txt" || {
    log::error "Failed to copy plugin mirroring summary to ${ARTIFACT_DIR}"
    return 1
  }
  log::info "Saved plugin mirroring summary to ${DISCONNECTED_TMPDIR} and ${ARTIFACT_DIR}"

  disconnected::_hook_post_mirror_plugins "${summary_src}"
}

# ---------------------------------------------------------------------------
# Catalog index resolution
# ---------------------------------------------------------------------------

# Resolve the mirrored plugin-catalog-index to a digest-pinned CATALOG_INDEX_IMAGE.
# Hub profile defaults often pin a digest that was never mirrored; inject the digest
# actually pushed by mirror-plugins so registries.conf can rewrite pulls to the mirror.
# Exports CATALOG_INDEX_REGISTRY, CATALOG_INDEX_REPO, CATALOG_INDEX_TAG, CATALOG_INDEX_IMAGE.
disconnected::resolve_catalog_index_image() {
  common::require_vars MIRROR_REGISTRY_URL RELEASE_VERSION || return 1

  local summary="${DISCONNECTED_TMPDIR}/rhdh-plugin-mirroring-summary.txt"
  local name="plugin-catalog-index"
  local line=""
  local left=""
  local right=""
  local digest=""

  if [[ ! -f "${summary}" ]]; then
    log::error "Plugin mirroring summary not found at ${summary}"
    log::error "Ensure disconnected::mirror_plugins ran successfully before resolve."
    return 1
  fi

  line=$(grep -F "${name}" "${summary}" | head -1) || true
  if [[ -z "${line}" ]]; then
    log::error "No summary line for ${name} in ${summary}"
    return 1
  fi

  left="${line%%→*}"
  right="${line#*→}"
  right="${right#"${right%%[![:space:]]*}"}"

  if [[ "${left}" =~ @(sha256:[0-9a-f]+) ]]; then
    digest="${BASH_REMATCH[1]}"
  elif [[ "${right}" =~ @(sha256:[0-9a-f]+) ]]; then
    digest="${BASH_REMATCH[1]}"
  else
    # Tag-only mapping — resolve digest from mirror.
    local tag="${RELEASE_VERSION}"
    if [[ "${right}" =~ :([^:@/[:space:]]+)[[:space:]]*$ ]]; then
      tag="${BASH_REMATCH[1]}"
    elif [[ "${left}" =~ :([^:@/[:space:]]+)[[:space:]]*$ ]]; then
      tag="${BASH_REMATCH[1]}"
    fi
    log::info "Catalog index summary has no digest; inspecting mirror tag :${tag}"
    digest=$(skopeo inspect --tls-verify=false \
      "docker://${MIRROR_REGISTRY_URL}/rhdh/${name}:${tag}" \
      --format '{{.Digest}}') || {
      log::error "Failed to inspect docker://${MIRROR_REGISTRY_URL}/rhdh/${name}:${tag}"
      return 1
    }
  fi

  if [[ -z "${digest}" || "${digest}" != sha256:* ]]; then
    log::error "Could not resolve digest for mirrored ${name} (got '${digest}')"
    return 1
  fi

  export CATALOG_INDEX_REGISTRY="registry.access.redhat.com"
  disconnected::_hook_catalog_index_exports "${name}" "${digest}"
  log::success "CATALOG_INDEX_IMAGE=${CATALOG_INDEX_IMAGE}"
}

# ---------------------------------------------------------------------------
# Homepage plugin ConfigMap (Operator)
# ---------------------------------------------------------------------------

# Create a ConfigMap from the static homepage-only dynamic-plugins.yaml
# (ref:// resolved through the mirrored catalog index).
# Args:
#   $1 - namespace
disconnected::create_homepage_plugins_configmap() {
  local namespace=$1
  local cm_name="dynamic-plugins-disconnected-smoke"
  local yaml="${DIR}/resources/disconnected/dynamic-plugins-homepage.yaml"

  oc create configmap "${cm_name}" \
    --from-file="dynamic-plugins.yaml=${yaml}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create ${cm_name} ConfigMap — aborting"
    return 1
  }
  cp "${yaml}" "${ARTIFACT_DIR}/disconnected-dynamic-plugins.yaml" 2> /dev/null || true
  log::success "ConfigMap ${cm_name} created in ${namespace}"
}

# Apply the shared plugin-mirror registries.conf ConfigMap in a namespace.
# Args:
#   $1 - namespace
disconnected::apply_plugin_mirror_configmap() {
  local namespace=$1
  local registries_template="${DIR}/resources/disconnected/plugin-mirror-registries.conf.tpl"
  local policy_file="${DIR}/resources/disconnected/policy.json"
  local tmp_registries="${DISCONNECTED_TMPDIR}/rhdh-registries.conf"

  envsubst < "${registries_template}" > "${tmp_registries}"

  oc create configmap rhdh-plugin-mirror-conf \
    --from-file=rhdh-registries.conf="${tmp_registries}" \
    --from-file=policy.json="${policy_file}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create registries.conf ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-conf created in ${namespace}"

  oc get configmap rhdh-plugin-mirror-conf -n "${namespace}" -o yaml \
    > "${ARTIFACT_DIR}/disconnected-plugin-mirror-configmap.yaml" 2> /dev/null || true
}
