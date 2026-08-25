#!/usr/bin/env bash

# Plugin mirroring, catalog index resolution, and homepage plugin helpers.

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

# Return an OCI package ref for the homepage plugin.
# Default (CI): use @<digest> pinning.
# Local override: use :sha256-<digest> tag format for ImageStream pulls.
disconnected::_hook_homepage_package_ref() {
  local name=$1 digest=$2
  echo "oci://registry.access.redhat.com/rhdh/${name}@${digest}!${name}"
}

# ---------------------------------------------------------------------------
# Shared catalog index source ref
# ---------------------------------------------------------------------------

# The (un-mirrored) OCI ref to pull the plugin catalog index from. Honors
# CATALOG_INDEX_IMAGE (Gangway override, or the CI pin in env_variables.sh —
# see CATALOG_INDEX_IMAGE_OVERRIDE); falls back to the product's
# registry.access.redhat.com ref for RELEASE_VERSION.
# Used both to mirror the index (mirror_plugins) and to read its contents
# directly (resolve_homepage_plugin_package): the CI/local runner has direct
# internet access to this source registry, so no mirror round-trip is needed
# just to inspect what the index pins.
# Must be called before disconnected::resolve_catalog_index_image, which
# overwrites CATALOG_INDEX_IMAGE with a canonical (mirror-consumption) form.
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
# Homepage plugin helpers
# ---------------------------------------------------------------------------

# Resolve the homepage frontend plugin straight from the plugin catalog
# index content, to a digest-pinned package ref.
#
# The frontend package name changed between releases (RHIDP-14515:
# red-hat-developer-hub-backstage-plugin-dynamic-home-page ->
# ...-plugin-homepage). Reading whichever one CATALOG_INDEX_IMAGE actually
# pins — instead of hardcoding a name or grepping the mirroring summary for
# both candidates — works unmodified whether the index is pinned (e.g.
# :1.10) or tracks :next, and survives any future rename.
#
# Always emits registry.access.redhat.com/rhdh/... (or the local ImageStream
# tag form — see _hook_homepage_package_ref) so registries.conf/the
# integrated registry serves the mirrored copy.
# Must run before disconnected::resolve_catalog_index_image, which
# overwrites CATALOG_INDEX_IMAGE with a canonical (mirror-consumption) form
# that is not necessarily pullable directly from its origin registry.
# Exports HOMEPAGE_PLUGIN_PACKAGE and HOMEPAGE_PLUGIN_FRONTEND_ID.
disconnected::resolve_homepage_plugin_package() {
  common::require_vars RELEASE_VERSION || return 1

  local index_ref
  index_ref="$(disconnected::_catalog_index_source_ref)"

  local tmp_dir
  tmp_dir=$(mktemp -d) || {
    log::error "Failed to create temp dir to inspect catalog index ${index_ref}"
    return 1
  }

  local rc=0
  disconnected::_homepage_plugin_from_oci_dir "${index_ref}" "${tmp_dir}" || rc=$?
  rm -rf "${tmp_dir}"
  return "${rc}"
}

# Pull the catalog index with skopeo, extract index.json, export HOMEPAGE_PLUGIN_*.
# Args:
#   $1 - index image ref to copy from
#   $2 - empty temp dir used for the dir: copy and extraction
disconnected::_homepage_plugin_from_oci_dir() {
  local index_ref=$1
  local tmp_dir=$2

  if ! skopeo copy --override-os linux --override-arch amd64 \
    "docker://${index_ref}" "dir:${tmp_dir}/oci" > "${tmp_dir}/skopeo.log" 2>&1; then
    log::error "Failed to pull catalog index ${index_ref} to resolve the homepage plugin"
    cat "${tmp_dir}/skopeo.log" >&2 || true
    return 1
  fi

  local layer_digest
  layer_digest=$(jq -r '.layers[0].digest' "${tmp_dir}/oci/manifest.json" 2> /dev/null)
  if [[ -z "${layer_digest}" || "${layer_digest}" == "null" ]]; then
    log::error "Could not determine content layer digest from ${index_ref} manifest"
    return 1
  fi

  mkdir -p "${tmp_dir}/extracted"
  # Match local catalog extraction: GNU tar auto-detects gzip, so -xf works for
  # both compressed and uncompressed OCI layer blobs (tar -xzf does not).
  tar -xf "${tmp_dir}/oci/${layer_digest#sha256:}" -C "${tmp_dir}/extracted" index.json || {
    log::error "Failed to extract index.json from catalog index ${index_ref}"
    return 1
  }

  # The homepage frontend package is the sole non-backend registryReference
  # matching *-plugin-homepage or *-plugin-dynamic-home-page (the literal
  # "-backend" suffix on the backend package's name means it never matches
  # "...homepage@sha256:" / "...dynamic-home-page@sha256:" directly).
  local ref
  ref=$(grep -oE '[^"]*-plugin-(dynamic-home-page|homepage)@sha256:[0-9a-f]+' \
    "${tmp_dir}/extracted/index.json" | head -1) || true
  if [[ -z "${ref}" ]]; then
    log::error "No homepage frontend registryReference found in catalog index ${index_ref}"
    return 1
  fi

  local name digest
  name="${ref%@*}"
  name="${name##*/}"
  digest="${ref##*@}"

  export HOMEPAGE_PLUGIN_PACKAGE
  HOMEPAGE_PLUGIN_PACKAGE=$(disconnected::_hook_homepage_package_ref "${name}" "${digest}")
  export HOMEPAGE_PLUGIN_FRONTEND_ID="red-hat-developer-hub.backstage-plugin-${name#red-hat-developer-hub-backstage-plugin-}"
  log::success "HOMEPAGE_PLUGIN_PACKAGE=${HOMEPAGE_PLUGIN_PACKAGE} (from catalog index ${index_ref})"
}

# Write the shared homepage-only dynamic-plugins.yaml (includes: [] + OCI plugin).
# Used by Operator (ConfigMap) and Helm (global.dynamic values overlay).
# Args:
#   $1 - destination path
disconnected::write_homepage_dynamic_plugins_yaml() {
  common::require_vars HOMEPAGE_PLUGIN_PACKAGE HOMEPAGE_PLUGIN_FRONTEND_ID || return 1

  local dest=$1
  local template="${DIR}/resources/disconnected/dynamic-plugins-homepage.yaml"
  envsubst < "${template}" > "${dest}"
}

# Create a minimal dynamic-plugins ConfigMap that enables the homepage OCI plugin.
# Args:
#   $1 - namespace
disconnected::create_homepage_plugins_configmap() {
  local namespace=$1
  local cm_name="dynamic-plugins-disconnected-smoke"
  local tmp_yaml="${DISCONNECTED_TMPDIR}/dynamic-plugins-disconnected-smoke.yaml"

  disconnected::write_homepage_dynamic_plugins_yaml "${tmp_yaml}" || return 1

  oc create configmap "${cm_name}" \
    --from-file="dynamic-plugins.yaml=${tmp_yaml}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create ${cm_name} ConfigMap — aborting"
    return 1
  }
  cp "${tmp_yaml}" "${ARTIFACT_DIR}/disconnected-dynamic-plugins.yaml" 2> /dev/null || true
  log::success "ConfigMap ${cm_name} created in ${namespace}"
}

# Wrap the Operator homepage plugin YAML as Helm values (global.dynamic).
# The chart templates that object into ${RELEASE_NAME}-dynamic-plugins.
# Args:
#   $1 - destination Helm values path
disconnected::write_homepage_helm_values() {
  local dest=$1
  local tmp_yaml="${DISCONNECTED_TMPDIR}/dynamic-plugins-disconnected-smoke.yaml"

  disconnected::write_homepage_dynamic_plugins_yaml "${tmp_yaml}" || return 1

  yq eval '{"global": {"dynamic": .}}' "${tmp_yaml}" > "${dest}" || {
    log::error "Failed to wrap homepage plugins as Helm values"
    return 1
  }
  cp "${dest}" "${ARTIFACT_DIR}/disconnected-helm-homepage-values.yaml" 2> /dev/null || true
  log::success "Helm homepage values written to ${dest}"
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
