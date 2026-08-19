#!/usr/bin/env bash

# oc-mirror image mirroring, IDMS/ITMS patching, and MCP wait helpers.

[[ -n "${_DISCONNECTED_MIRROR_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_MIRROR_SOURCED=1

# ---------------------------------------------------------------------------
# Hooks — overridable by local.sh (or other consumers) to customise CI-only
# behaviour for local-disconnected or alternative registry setups.
# ---------------------------------------------------------------------------

# Whether to add the hub image (IMAGE_REGISTRY/IMAGE_REPO:TAG_NAME) to the
# oc-mirror additionalImages list. Return 0 (yes) or 1 (skip).
# Local override: the integrated registry cannot store docker manifest lists
# while oc-mirror preserve-digests is active; the chart hub digest suffices.
disconnected::_hook_should_add_hub_image() { return 0; }

# Append extra flags to the oc-mirror argument array (passed by nameref).
# Local override: adds --remove-signatures (OpenShift integrated registry
# rejects cosign/sigstore .sig attachments).
disconnected::_hook_adjust_oc_mirror_args() { :; }

# Execute the oc-mirror command. Default: run directly.
# Local override: wraps with retry_on_local_registry (Recreate + RWO PVC
# leaves the integrated registry route at HTTP 503).
disconnected::_hook_run_oc_mirror() { "$@"; }

# Post-process an IDMS/ITMS YAML file emitted by oc-mirror.
# Local override: rewrites the push-route host to the in-cluster registry
# service so kubelet can authenticate.
disconnected::_hook_rewrite_mirror_host() { :; }

# ---------------------------------------------------------------------------
# CI-safe defaults — called unconditionally by job handlers; local.sh
# overrides with real logic. Must stay defined in a CI-sourced module.
# ---------------------------------------------------------------------------

# Retry wrapper for commands that interact with the OCP integrated registry.
# CI default: pass-through (external bastion mirror never needs retry).
# Local override: waits for the integrated-registry Recreate to finish (RWO
# PVC + Recreate strategy leaves the route at HTTP 503 during rollout).
disconnected::retry_on_local_registry() {
  shift
  "$@"
}

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

# Wait until https://${MIRROR_REGISTRY_URL}/v2/ answers with something other
# than connection-failure (000) or HTTP 503. Shared by CI bastion and local
# integrated-registry modes.
disconnected::wait_mirror_registry_route() {
  local timeout_s="${1:-900}"
  local interval_s=5
  local waited=0
  local probe_code=""

  if [[ -z "${MIRROR_REGISTRY_URL:-}" ]]; then
    log::error "MIRROR_REGISTRY_URL is unset; cannot probe mirror registry"
    return 1
  fi

  log::info "Probing mirror registry route until ready (timeout ${timeout_s}s)..."
  while ((waited < timeout_s)); do
    probe_code=$(curl -sk -o /dev/null -w '%{http_code}' \
      "https://${MIRROR_REGISTRY_URL}/v2/" || true)
    if [[ "${probe_code}" != "000" && "${probe_code}" != "503" ]]; then
      log::info "Mirror registry route ready (HTTP ${probe_code})"
      return 0
    fi
    sleep "${interval_s}"
    waited=$((waited + interval_s))
  done
  log::error "Mirror registry route still unavailable after ${timeout_s}s (HTTP ${probe_code:-none})"
  return 1
}

# Host used in IDMS/ITMS/Helm image refs for cluster pulls.
# Local override: replace entirely to return the in-cluster integrated
# registry service (kubelet auth) instead of the external route.
disconnected::cluster_mirror_host() {
  printf '%s' "${MIRROR_REGISTRY_URL}"
}

# Build an ImageSetConfiguration for oc-mirror.
# The configuration is dynamically generated based on IMAGE_REGISTRY:
#   - registry.redhat.io (GA): uses helm.local with chart pulled from charts.openshift.io
#   - anything else (CI/upstream): uses helm.local with chart pulled from OCI
# Args:
#   $1 - output_path: Path to write the ImageSetConfiguration YAML
disconnected::build_imageset_config() {
  local output_path=$1

  cat > "${output_path}" << EOF
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  helm:
    local:
      - name: redhat-developer-hub
        path: ${CHART_LOCAL_TGZ}
EOF

  # Additional images that need mirroring beyond what the chart references.
  local additional_images=()

  # When the hub image is overridden (different from chart defaults), add it
  # so oc-mirror mirrors the actual image we'll deploy with.
  if [[ "${IMAGE_REGISTRY}" != "registry.redhat.io" ]] && disconnected::_hook_should_add_hub_image; then
    additional_images+=("${IMAGE_REGISTRY}/${IMAGE_REPO}:${TAG_NAME}")
  fi

  # PG image: CI charts may use quay.io/fedora/postgresql-15 instead of
  # registry.redhat.io/rhel9/postgresql-15.
  if [[ "${PG_REGISTRY:-registry.redhat.io}" != "registry.redhat.io" ]]; then
    additional_images+=("${PG_REGISTRY}/${PG_REPO}${PG_SEPARATOR}${PG_TAG}")
  fi

  # Catalog index: the chart references it by digest and the init container
  # pulls it at startup. Must be mirrored so IDMS can redirect the pull.
  if [[ -n "${CI_REGISTRY:-}" && -n "${CI_REPO:-}" && -n "${CI_TAG:-}" ]]; then
    additional_images+=("${CI_REGISTRY}/${CI_REPO}${CI_SEPARATOR:-:}${CI_TAG}")
  fi

  if [[ ${#additional_images[@]} -gt 0 ]]; then
    {
      echo "  additionalImages:"
      for img in "${additional_images[@]}"; do
        echo "    - name: ${img}"
      done
    } >> "${output_path}"
  fi

  log::info "ImageSetConfiguration written to ${output_path}"
  log::debug "$(cat "${output_path}")"

  cp "${output_path}" "${ARTIFACT_DIR}/disconnected-imageset-config.yaml" 2> /dev/null || true
}

# Run oc-mirror to mirror images to the disconnected mirror registry.
# Sets OC_MIRROR_IDMS_FILE, OC_MIRROR_ITMS_FILE, and OC_MIRROR_CHART_PATH.
# Args:
#   $1 - imageset_config: Path to the ImageSetConfiguration YAML
#   $2 - workspace_dir: Path to the oc-mirror workspace directory
disconnected::run_oc_mirror() {
  local imageset_config=$1
  local workspace_dir=$2

  mkdir -p "${workspace_dir}"

  local oc_mirror_args=(
    -c "${imageset_config}"
    "docker://${MIRROR_REGISTRY_URL}"
    --dest-tls-verify=false
    --v2
    --workspace "file://${workspace_dir}"
  )
  disconnected::_hook_adjust_oc_mirror_args oc_mirror_args

  log::info "Running oc-mirror --v2 -> ${MIRROR_REGISTRY_URL} (${oc_mirror_args[*]})"
  # REGISTRY_AUTH_FILE must be unset: oc-mirror (distribution/distribution)
  # panics when it is set because it treats it as a storage driver config.
  # Auth still comes from ${XDG_RUNTIME_DIR}/containers/auth.json.
  if ! disconnected::_hook_run_oc_mirror \
    disconnected::with_unset_registry_auth_file oc-mirror "${oc_mirror_args[@]}"; then
    log::error "oc-mirror failed"
    return 1
  fi

  local result_dir="${workspace_dir}/working-dir"

  # IDMS (required)
  OC_MIRROR_IDMS_FILE="${result_dir}/cluster-resources/idms-oc-mirror.yaml"
  if [[ ! -s "${OC_MIRROR_IDMS_FILE}" ]]; then
    log::error "oc-mirror did not generate IDMS at ${OC_MIRROR_IDMS_FILE}"
    return 1
  fi
  export OC_MIRROR_IDMS_FILE

  # ITMS (optional)
  OC_MIRROR_ITMS_FILE="${result_dir}/cluster-resources/itms-oc-mirror.yaml"
  if [[ ! -s "${OC_MIRROR_ITMS_FILE}" ]]; then
    OC_MIRROR_ITMS_FILE=""
  fi
  export OC_MIRROR_ITMS_FILE

  OC_MIRROR_CHART_PATH=$(find "${result_dir}/helm/charts" -name '*.tgz' 2> /dev/null | head -1)
  export OC_MIRROR_CHART_PATH

  disconnected::_hook_rewrite_mirror_host "${OC_MIRROR_IDMS_FILE}"
  if [[ -n "${OC_MIRROR_ITMS_FILE}" ]]; then
    disconnected::_hook_rewrite_mirror_host "${OC_MIRROR_ITMS_FILE}"
  fi

  log::success "oc-mirror completed successfully"
  log::info "IDMS: ${OC_MIRROR_IDMS_FILE}"
  [[ -n "${OC_MIRROR_ITMS_FILE}" ]] && log::info "ITMS: ${OC_MIRROR_ITMS_FILE}"
  [[ -n "${OC_MIRROR_CHART_PATH}" ]] && log::info "Chart: ${OC_MIRROR_CHART_PATH}"

  cp "${OC_MIRROR_IDMS_FILE}" "${ARTIFACT_DIR}/disconnected-idms-generated.yaml" 2> /dev/null || true
  [[ -n "${OC_MIRROR_ITMS_FILE}" ]] && cp "${OC_MIRROR_ITMS_FILE}" "${ARTIFACT_DIR}/disconnected-itms-generated.yaml" 2> /dev/null || true
}

# Patch the oc-mirror-generated IDMS to ensure both quay.io and
# registry.redhat.io sources are covered, regardless of what oc-mirror
# discovered from the chart. This is needed because:
#   - GA charts reference registry.redhat.io but CI verification may override to quay.io
#   - CI charts reference quay.io but post-GA verification uses registry.redhat.io
# Args:
#   $1 - idms_file: Path to the IDMS YAML to patch
disconnected::patch_idms() {
  local idms_file=$1

  log::info "Patching IDMS with cross-registry mirror entries"

  local mirror_host
  mirror_host=$(disconnected::cluster_mirror_host)

  for source_registry in "quay.io" "registry.redhat.io"; do
    local source="${source_registry}/${IMAGE_REPO}"
    local mirror="${mirror_host}/${IMAGE_REPO}"

    if yq eval ".spec.imageDigestMirrors[].source" "${idms_file}" 2> /dev/null | grep -qF "${source}"; then
      log::debug "IDMS already contains entry for ${source}"
      continue
    fi

    yq eval -i \
      ".spec.imageDigestMirrors += [{\"mirrors\": [\"${mirror}\"], \"source\": \"${source}\"}]" \
      "${idms_file}"
    log::info "Added IDMS entry: ${source} -> ${mirror}"
  done

  # PG_REPO is already cleaned of @sha256 by the caller (via PG_SEPARATOR).
  if [[ -n "${PG_REGISTRY:-}" && -n "${PG_REPO:-}" ]]; then
    local pg_source="${PG_REGISTRY}/${PG_REPO}"
    local pg_mirror="${mirror_host}/${PG_REPO}"

    if ! yq eval ".spec.imageDigestMirrors[].source" "${idms_file}" 2> /dev/null | grep -qF "${pg_source}"; then
      yq eval -i \
        ".spec.imageDigestMirrors += [{\"mirrors\": [\"${pg_mirror}\"], \"source\": \"${pg_source}\"}]" \
        "${idms_file}"
      log::info "Added IDMS entry: ${pg_source} -> ${pg_mirror}"
    fi
  fi

  log::debug "Patched IDMS:"
  log::debug "$(cat "${idms_file}")"

  cp "${idms_file}" "${ARTIFACT_DIR}/disconnected-idms-patched.yaml" 2> /dev/null || true
}

# Wait for MachineConfigPool updates after IDMS/CatalogSource changes.
# Warns and continues on timeout (same behavior as both handlers historically).
disconnected::wait_mcp_updated() {
  log::info "Waiting for MachineConfigPool updates to complete (up to 20m)..."
  if oc wait machineconfigpool --all --for=condition=Updated=True --timeout=20m; then
    log::success "All MachineConfigPools are Updated"
  else
    log::warn "MachineConfigPool wait timed out -- proceeding anyway"
  fi
}
