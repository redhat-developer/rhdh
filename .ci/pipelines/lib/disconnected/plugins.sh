#!/usr/bin/env bash

# Plugin mirroring, catalog index resolution, and smoke plugin ConfigMap.

[[ -n "${_DISCONNECTED_PLUGINS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_PLUGINS_SOURCED=1

# Smoke only installs this plugin set (includes: []). Full-catalog mirroring is
# RHIDP-13967. On the 2.x New Frontend System hub the sign-in page (app-auth),
# sidebar (app-defaults), SCM integrations (app-integrations) and guest auth
# provider are dynamic plugins, so the homepage alone cannot render a login.
readonly -a DISCONNECTED_SMOKE_PLUGIN_NAMES=(
  "red-hat-developer-hub-backstage-plugin-app-auth"
  "red-hat-developer-hub-backstage-plugin-app-defaults"
  "red-hat-developer-hub-backstage-plugin-app-integrations"
  "red-hat-developer-hub-backstage-plugin-homepage"
  "backstage-plugin-auth-backend-module-guest-provider"
)

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

# Mirror destination for the catalog index (last two path elements: rhdh/plugin-catalog-index).
# Args:
#   $1 - catalog index ref (with or without oci://)
disconnected::_catalog_index_mirror_dest() {
  local index_ref="${1#oci://}"
  local catalog_dest="${MIRROR_REGISTRY_URL}/rhdh/plugin-catalog-index"
  if [[ "${index_ref}" =~ @sha256:[0-9a-f]+$ ]]; then
    catalog_dest="${catalog_dest}@${index_ref##*@}"
  elif [[ "${index_ref}" =~ :([^:/]+)$ ]]; then
    catalog_dest="${catalog_dest}:${BASH_REMATCH[1]}"
  else
    catalog_dest="${catalog_dest}:latest"
  fi
  printf '%s' "${catalog_dest}"
}

# Build a plugin-list file of digest-pinned oci:// refs from a catalog index.
# Skips fragile :tag refs that next catalogs sometimes publish without images.
# Args:
#   $1 - plugin_index (oci://...)
#   $2 - output list file path
#   $3 - optional space-separated package names; keep only matching refs
disconnected::write_digest_plugin_list() {
  local plugin_index=$1
  local list_file=$2
  local name_filters=${3:-}
  local index_ref="${plugin_index#oci://}"
  local extract_dir
  extract_dir=$(mktemp -d)

  log::info "Extracting catalog index for digest-only plugin list: ${plugin_index}"
  # Catalog index is linux/amd64-only; override so this works on darwin/arm64 hosts
  # as well as in the linux e2e-runner.
  if ! skopeo copy --override-os linux --override-arch amd64 \
    "docker://${index_ref}" "dir:${extract_dir}/idx"; then
    log::error "Failed to extract catalog index ${index_ref}"
    rm -rf "${extract_dir}"
    return 1
  fi

  local data_dir="${extract_dir}/data"
  mkdir -p "${data_dir}"
  local layer
  for layer in "${extract_dir}/idx"/*; do
    if [[ -f "${layer}" && ! "${layer}" =~ (manifest\.json|version)$ ]]; then
      tar -xf "${layer}" -C "${data_dir}" 2> /dev/null || true
    fi
  done

  if [[ ! -f "${data_dir}/index.json" ]]; then
    log::error "No index.json in catalog index image"
    rm -rf "${extract_dir}"
    return 1
  fi

  : > "${list_file}"
  jq -r '
    .. | objects | .registryReference? // empty
  ' "${data_dir}/index.json" 2> /dev/null \
    | sed -E 's#^(oci://)?#oci://#' \
    | grep -E '@sha256:[0-9a-f]+' >> "${list_file}" || true

  if [[ -f "${data_dir}/dynamic-plugins.default.yaml" ]]; then
    grep -oE 'oci://[^[:space:]]+@sha256:[0-9a-f]+[^[:space:]]*' "${data_dir}/dynamic-plugins.default.yaml" >> "${list_file}" || true # notsecret
  fi

  # Deduplicate; strip !package suffix for skopeo (mirror-plugins accepts either).
  if [[ -s "${list_file}" ]]; then
    local tmp
    tmp=$(mktemp)
    sed -E 's/!.*//' "${list_file}" | sort -u > "${tmp}"
    mv "${tmp}" "${list_file}"
  fi

  if [[ -n "${name_filters}" && -s "${list_file}" ]]; then
    local filtered pattern
    filtered=$(mktemp)
    # Path-segment match so "...-homepage" does not also keep "...-homepage-backend".
    pattern="${name_filters// /|}"
    grep -E "/(${pattern})(@|:)" "${list_file}" > "${filtered}" || true
    mv "${filtered}" "${list_file}"
  fi

  local count
  count=$(wc -l < "${list_file}" | tr -d ' ')
  rm -rf "${extract_dir}"

  if [[ "${count}" -lt 1 ]]; then
    if [[ -n "${name_filters}" ]]; then
      log::error "No digest-pinned plugin matched: ${name_filters}"
    else
      log::error "No digest-pinned plugins found in catalog index"
    fi
    return 1
  fi
  if [[ -n "${name_filters}" ]]; then
    log::info "Plugin list filtered to ${count} digest-pinned ref(s) for: ${name_filters}"
  else
    log::info "${count} digest-pinned plugins (tag-only refs skipped)"
  fi
}

# Copy the catalog index to the mirror and record it in the mirroring summary.
# --plugin-list does not copy the index; deploy still injects CATALOG_INDEX_IMAGE.
# Args:
#   $1 - plugin_index (oci://...)
disconnected::copy_catalog_index_to_mirror() {
  local plugin_index=$1
  local index_ref="${plugin_index#oci://}"
  local catalog_dest
  catalog_dest=$(disconnected::_catalog_index_mirror_dest "${index_ref}")

  log::info "Mirroring catalog index -> ${catalog_dest}"
  skopeo copy --all --dest-tls-verify=false \
    "docker://${index_ref}" "docker://${catalog_dest}" || {
    log::error "Failed to mirror catalog index ${index_ref}"
    return 1
  }

  local summary_src
  summary_src="$(pwd)/rhdh-plugin-mirroring-summary.txt"
  if [[ -f "${summary_src}" ]] && ! grep -qF 'plugin-catalog-index' "${summary_src}"; then
    echo "${plugin_index} -> oci://${catalog_dest}" >> "${summary_src}"
  fi
}

# Package name -> env var rendered by the envsubst templates.
# Args:
#   $1 - plugin package name (last OCI path segment)
disconnected::_smoke_plugin_package_var() {
  case "$1" in
    red-hat-developer-hub-backstage-plugin-app-auth) echo "APP_AUTH_PLUGIN_PACKAGE" ;;
    red-hat-developer-hub-backstage-plugin-app-defaults) echo "APP_DEFAULTS_PLUGIN_PACKAGE" ;;
    red-hat-developer-hub-backstage-plugin-app-integrations) echo "APP_INTEGRATIONS_PLUGIN_PACKAGE" ;;
    red-hat-developer-hub-backstage-plugin-homepage) echo "HOMEPAGE_PLUGIN_PACKAGE" ;;
    backstage-plugin-auth-backend-module-guest-provider) echo "GUEST_PROVIDER_PLUGIN_PACKAGE" ;;
    *) return 1 ;;
  esac
}

# Export one <NAME>_PLUGIN_PACKAGE per smoke plugin from the digest plugin list.
# Adds !name if the list line has no OCI subpath (install-dynamic-plugins needs it).
# Args:
#   $1 - plugin list file from write_digest_plugin_list
disconnected::set_smoke_plugin_packages_from_list() {
  local list_file=$1
  local name="" var="" line="" exported=0

  for name in "${DISCONNECTED_SMOKE_PLUGIN_NAMES[@]}"; do
    line=$(grep -E "/${name}(@|:)" "${list_file}" 2> /dev/null | head -1 || true)
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [[ -z "${line}" ]]; then
      log::error "No digest-pinned ${name} plugin in ${list_file}"
      return 1
    fi
    if [[ "${line}" != *'!'* ]]; then
      line="${line}!${name}"
    fi
    var=$(disconnected::_smoke_plugin_package_var "${name}") || {
      log::error "No package variable mapped for plugin ${name}"
      return 1
    }
    export "${var}=${line}"
    log::success "${var}=${line}"
    exported=$((exported + 1))
  done

  log::info "Exported ${exported} smoke plugin package(s)"
}

# Build the digest-pinned smoke plugin list and export its package variables.
# Args:
#   $1 - output list file path
disconnected::write_smoke_plugin_list() {
  local list_file=$1
  local plugin_index
  plugin_index="oci://$(disconnected::_catalog_index_source_ref)"

  disconnected::write_digest_plugin_list "${plugin_index}" "${list_file}" \
    "${DISCONNECTED_SMOKE_PLUGIN_NAMES[*]}" || return 1
  disconnected::set_smoke_plugin_packages_from_list "${list_file}" || return 1
}

# ---------------------------------------------------------------------------
# mirror_plugins — fetch and run mirror-plugins.sh against the mirror registry
# ---------------------------------------------------------------------------

# Smoke: the minimal NFS plugin set (--plugin-list) plus the catalog index
# (CATALOG_INDEX_IMAGE). --plugin-index would enumerate every catalog plugin,
# including unpublished :tag refs.
disconnected::mirror_plugins() {
  local mirror_script="${DISCONNECTED_TMPDIR}/mirror-plugins.sh"

  disconnected::fetch_operator_repo_script "mirror-plugins.sh" "${mirror_script}" || {
    log::error "Failed to fetch mirror-plugins.sh — aborting"
    return 1
  }

  local plugin_index
  plugin_index="oci://$(disconnected::_catalog_index_source_ref)"

  local list_file="${DISCONNECTED_TMPDIR}/smoke-plugins.txt"
  disconnected::write_smoke_plugin_list "${list_file}" || return 1

  disconnected::wait_mirror_registry_route 300 || return 1
  bash "${mirror_script}" \
    --plugin-list "${list_file}" \
    --to-registry "${MIRROR_REGISTRY_URL}" || {
    log::error "mirror-plugins.sh failed — aborting"
    return 1
  }

  disconnected::copy_catalog_index_to_mirror "${plugin_index}" || return 1

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
# Smoke plugin ConfigMap (Operator)
# ---------------------------------------------------------------------------

# Create a ConfigMap from the smoke dynamic-plugins.yaml
# (digest-pinned OCI packages; includes: [] skips catalog defaults).
# Args:
#   $1 - namespace
disconnected::create_smoke_plugins_configmap() {
  common::require_vars HOMEPAGE_PLUGIN_PACKAGE APP_AUTH_PLUGIN_PACKAGE \
    APP_DEFAULTS_PLUGIN_PACKAGE APP_INTEGRATIONS_PLUGIN_PACKAGE \
    GUEST_PROVIDER_PLUGIN_PACKAGE || return 1
  local namespace=$1
  local cm_name="dynamic-plugins-disconnected-smoke"
  local template="${DIR}/resources/disconnected/dynamic-plugins-smoke.yaml"
  local tmp_yaml="${DISCONNECTED_TMPDIR}/dynamic-plugins-disconnected-smoke.yaml"

  envsubst < "${template}" > "${tmp_yaml}" || {
    log::error "Failed to render ${template}"
    return 1
  }

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
