#!/usr/bin/env bash
# LOCAL_DISCONNECTED plugin mirroring: homepage-only mirror_plugins override
# (retry loop, skopeo catalog copy, imagestream tagging). Sourced only when
# LOCAL_DISCONNECTED=1.

[[ -n "${_DISCONNECTED_LOCAL_PLUGINS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_PLUGINS_SOURCED=1

# Full override: homepage-only plugin list, retry loop, skopeo catalog copy,
# summary handling, and imagestream tagging.
disconnected::mirror_plugins() {
  local mirror_script="${DISCONNECTED_TMPDIR}/mirror-plugins.sh"

  disconnected::fetch_operator_repo_script "mirror-plugins.sh" "${mirror_script}" || {
    log::error "Failed to fetch mirror-plugins.sh -- aborting"
    return 1
  }

  local plugin_index
  plugin_index="oci://$(disconnected::_catalog_index_source_ref)"

  local list_file="${DISCONNECTED_TMPDIR}/homepage-plugins.txt"
  disconnected::write_digest_plugin_list "${plugin_index}" "${list_file}" \
    "${DISCONNECTED_HOMEPAGE_PLUGIN_NAME}" || return 1
  disconnected::set_homepage_plugin_package_from_list "${list_file}" || return 1

  # --plugin-list only (not --plugin-index): index mode re-adds fragile tags.
  # Catalog index is mirrored after plugins so the summary still records it.
  local attempt
  local max_attempts=5
  local mirrored=0
  for attempt in $(seq 1 "${max_attempts}"); do
    disconnected::wait_local_integrated_registry || return 1
    if bash "${mirror_script}" \
      --plugin-list "${list_file}" \
      --to-registry "${MIRROR_REGISTRY_URL}"; then
      mirrored=1
      break
    fi
    log::warn "mirror-plugins.sh attempt ${attempt}/${max_attempts} failed (registry 503 during Recreate is typical)"
  done
  if [[ "${mirrored}" != "1" ]]; then
    log::error "mirror-plugins.sh (homepage plugin list) failed after ${max_attempts} attempts -- aborting"
    return 1
  fi

  local index_ref="${plugin_index#oci://}"
  local catalog_dest
  catalog_dest=$(disconnected::_catalog_index_mirror_dest "${index_ref}")
  # Use real skopeo --all (not the amd64 shim): destination @sha256 must stay the
  # multi-arch list digest; single-arch flatten yields "digest invalid".
  local real_skopeo=""
  local candidate
  for candidate in /usr/bin/skopeo /usr/local/bin/skopeo; do
    if [[ -x "${candidate}" ]]; then
      real_skopeo="${candidate}"
      break
    fi
  done
  if [[ -z "${real_skopeo}" ]]; then
    real_skopeo=$(type -P skopeo)
    while [[ "${real_skopeo}" == *disconnected-skopeo-shim* ]]; do
      real_skopeo=$(PATH="${PATH#"${real_skopeo%/*}":}" type -P skopeo) || break
    done
  fi
  log::info "Mirroring catalog index -> ${catalog_dest} (skopeo --all)"
  local index_copied=0
  for attempt in $(seq 1 "${max_attempts}"); do
    disconnected::wait_local_integrated_registry || return 1
    if "${real_skopeo}" copy --all --remove-signatures --dest-tls-verify=false \
      "docker://${index_ref}" "docker://${catalog_dest}"; then
      index_copied=1
      break
    fi
    log::warn "catalog index copy attempt ${attempt}/${max_attempts} failed"
  done
  if [[ "${index_copied}" != "1" ]]; then
    log::error "Failed to mirror catalog index ${index_ref}"
    return 1
  fi
  # Ensure summary includes catalog index for resolve_catalog_index_image.
  local summary_src
  summary_src="$(pwd)/rhdh-plugin-mirroring-summary.txt"
  if [[ -f "${summary_src}" ]] && ! grep -qF 'plugin-catalog-index' "${summary_src}"; then
    echo "${plugin_index} -> oci://${catalog_dest}" >> "${summary_src}"
  fi

  # Copy summary to standard locations.
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

  disconnected::ensure_local_plugin_imagestream_tags "${summary_src}" || return 1
}

# Create ImageStream tags for digest-mirrored plugins by re-pushing each
# source@digest to <mirror>/<ns>/<name>:sha256-<digest>. The integrated
# registry only serves pulls through ImageStreams; digest-only skopeo pushes
# leave Image objects without stream tags -> HTTP 500/404 on pull.
# Args:
#   $1 - path to rhdh-plugin-mirroring-summary.txt
disconnected::ensure_local_plugin_imagestream_tags() {
  local summary=$1
  if [[ ! -f "${summary}" ]]; then
    log::error "Plugin mirroring summary not found at ${summary}"
    return 1
  fi

  common::require_vars MIRROR_REGISTRY_URL || return 1

  log::section "Ensuring ImageStream tags for mirrored plugins"
  local line src dest src_ref dest_path name ns digest tag dest_tagged
  local ok=0 fail=0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" != *"→"* && "${line}" != *"->"* ]] && continue
    if [[ "${line}" == *"→"* ]]; then
      src="${line%%→*}"
      dest="${line#*→}"
    else
      src="${line%%->*}"
      dest="${line#*->}"
    fi
    src=$(echo "${src}" | xargs)
    dest=$(echo "${dest}" | xargs)
    src_ref="${src#oci://}"
    dest="${dest#oci://}"
    dest="${dest#docker://}"
    [[ "${src_ref}" != *@sha256:* ]] && continue
    digest="${src_ref##*@}"
    [[ "${digest}" =~ ^sha256:[0-9a-f]+$ ]] || continue

    # dest like registry/ns/name@sha256:... or registry/ns/name:tag
    dest_path="${dest%%@*}"
    # Strip :tag only from the name segment (host has no port in local route case).
    if [[ "${dest_path}" == *"/"*":"* ]]; then
      dest_path="${dest_path%:*}"
    fi
    name="${dest_path##*/}"
    ns="${dest_path%/*}"
    ns="${ns##*/}"
    if [[ -z "${ns}" || -z "${name}" || "${ns}" == "${name}" ]]; then
      log::warn "Skipping unparsable mirror dest: ${dest}"
      continue
    fi

    # Push targets are data-driven by plugin source paths (e.g. rhdh,
    # rhdh-plugin-export-overlays). The integrated registry rejects manifest
    # writes to a missing project ("denied"); create it before pushing.
    disconnected::ensure_local_mirror_namespace "${ns}" || {
      log::error "Failed to ensure project ${ns} for ${ns}/${name}"
      fail=$((fail + 1))
      continue
    }

    tag="sha256-${digest#sha256:}"
    dest_tagged="${MIRROR_REGISTRY_URL}/${ns}/${name}:${tag}"
    log::info "Tagging ${ns}/${name}@${digest} -> :${tag}"
    if skopeo copy --remove-signatures --dest-tls-verify=false \
      "docker://${src_ref}" "docker://${dest_tagged}"; then
      ok=$((ok + 1))
    else
      log::error "Failed to create ImageStream tag for ${ns}/${name}"
      fail=$((fail + 1))
    fi
  done < "${summary}"

  if [[ "${fail}" -gt 0 ]]; then
    log::error "ImageStream tagging finished with ${fail} failure(s), ${ok} succeeded"
    return 1
  fi
  if [[ "${ok}" -eq 0 ]]; then
    log::warn "No digest-pinned plugins found to tag in ${summary}"
    return 0
  fi
  log::success "Created ImageStream tags for ${ok} mirrored plugins"
}
