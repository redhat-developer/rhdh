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
# CI-safe defaults — called unconditionally by job handlers; local.sh
# overrides with real logic. Must stay defined in a CI-sourced module.
# ---------------------------------------------------------------------------

# Pin CATALOG_INDEX_IMAGE from the Helm chart digest (for local dev where
# Gangway is not available). CI default: no-op (Gangway / env provides
# CATALOG_INDEX_IMAGE).
disconnected::pin_local_catalog_index_from_chart() { :; }

# ---------------------------------------------------------------------------
# mirror_plugins — fetch and run mirror-plugins.sh against the mirror registry
# ---------------------------------------------------------------------------

# Uses CATALOG_INDEX_IMAGE when set; otherwise the GA plugin-catalog-index tag.
disconnected::mirror_plugins() {
  local mirror_script="${DISCONNECTED_TMPDIR}/mirror-plugins.sh"

  disconnected::fetch_script "mirror-plugins.sh" "${mirror_script}" || {
    log::error "Failed to fetch mirror-plugins.sh — aborting"
    return 1
  }

  local plugin_index="oci://registry.access.redhat.com/rhdh/plugin-catalog-index:${RELEASE_VERSION}"
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    plugin_index="oci://${CATALOG_INDEX_IMAGE}"
  fi

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

# Resolve the mirrored homepage OCI plugin to a digest-pinned package ref.
# Prefer dynamic-home-page (published on Quay); fall back to homepage after the
# RHIDP-14515 rename lands (RHDHBUGS-3515 — new repo may still be missing).
# Always emits registry.access.redhat.com/rhdh/... so registries.conf rewrites to the mirror.
# Exports HOMEPAGE_PLUGIN_PACKAGE and HOMEPAGE_PLUGIN_FRONTEND_ID.
disconnected::resolve_homepage_plugin_package() {
  local summary="${DISCONNECTED_TMPDIR}/rhdh-plugin-mirroring-summary.txt"
  local name=""
  local line=""
  local left=""
  local digest=""
  local candidate=""

  if [[ ! -f "${summary}" ]]; then
    log::error "Plugin mirroring summary not found at ${summary}"
    log::error "Ensure disconnected::mirror_plugins ran successfully before resolve."
    return 1
  fi

  for candidate in \
    "red-hat-developer-hub-backstage-plugin-dynamic-home-page" \
    "red-hat-developer-hub-backstage-plugin-homepage"; do
    # Match "/<name>@" so homepage does not also hit homepage-backend.
    line=$(grep -F "/${candidate}@" "${summary}" | head -1) || true
    if [[ -n "${line}" ]]; then
      name="${candidate}"
      break
    fi
  done

  if [[ -z "${name}" || -z "${line}" ]]; then
    log::error "No summary line for homepage plugin (dynamic-home-page or homepage) in ${summary}"
    return 1
  fi

  # mirror-plugins.sh normally emits "→"; accept ASCII "->" too (matches the
  # separator handling in local.sh's ImageStream tagging loop).
  if [[ "${line}" == *"→"* ]]; then
    left="${line%%→*}"
  elif [[ "${line}" == *"->"* ]]; then
    left="${line%%->*}"
  else
    log::error "Summary line for ${name} has no separator: ${line}"
    return 1
  fi

  if [[ ! "${left}" =~ @(sha256:[0-9a-f]+) ]]; then
    log::error "Could not extract @sha256 digest from summary line left side: ${left}"
    return 1
  fi
  digest="${BASH_REMATCH[1]}"

  export HOMEPAGE_PLUGIN_PACKAGE
  HOMEPAGE_PLUGIN_PACKAGE=$(disconnected::_hook_homepage_package_ref "${name}" "${digest}")
  if [[ "${name}" == *"-plugin-homepage" ]]; then
    export HOMEPAGE_PLUGIN_FRONTEND_ID="red-hat-developer-hub.backstage-plugin-homepage"
  else
    export HOMEPAGE_PLUGIN_FRONTEND_ID="red-hat-developer-hub.backstage-plugin-dynamic-home-page"
  fi
  log::success "HOMEPAGE_PLUGIN_PACKAGE=${HOMEPAGE_PLUGIN_PACKAGE} (from mirroring summary)"
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
  local configmap_template="${DIR}/resources/disconnected/plugin-mirror-configmap.yaml"

  envsubst < "${configmap_template}" \
    | oc apply -n "${namespace}" -f - || {
    log::error "Failed to create registries.conf ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-conf created in ${namespace}"

  envsubst < "${configmap_template}" \
    > "${ARTIFACT_DIR}/disconnected-plugin-mirror-configmap.yaml" 2> /dev/null || true
}
