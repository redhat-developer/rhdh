#!/usr/bin/env bash

# Shared utility functions for disconnected CI pipeline handlers.
# Provides environment validation, oc-mirror-based image mirroring,
# auth setup, and external script fetching.
#
# Dependencies: lib/log.sh, lib/common.sh
# Consumers: jobs/ocp-disconnected-helm.sh, jobs/ocp-disconnected-operator.sh

# Prevent re-sourcing
if [[ -n "${DISCONNECTED_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly DISCONNECTED_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ci/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"

# Create a dedicated temp directory for disconnected CI artifacts.
DISCONNECTED_TMPDIR=$(mktemp -d)
export DISCONNECTED_TMPDIR

# Validate that all required disconnected environment variables are set.
# These are exported by the step-registry commands.sh before calling
# openshift-ci-tests.sh.
disconnected::require_env() {
  if [[ "${DISCONNECTED:-}" != "true" ]]; then
    log::error "DISCONNECTED is not set to 'true'. This handler requires a disconnected environment."
    log::error "Ensure the step-registry commands.sh has run before this handler."
    return 1
  fi

  common::require_vars \
    MIRROR_REGISTRY_URL \
    MIRROR_REGISTRY_PULL_SECRET \
    MIRROR_REGISTRY_CA
}

# Configure container-tools authentication for skopeo, oc-mirror, and
# mirror-plugins.sh. Places the combined pull secret (which contains
# credentials for both source registries and the mirror registry) in
# the standard locations expected by these tools.
disconnected::setup_auth() {
  export HOME="${HOME:-/tmp/home}"
  export XDG_RUNTIME_DIR="${HOME}/run"
  mkdir -p "${XDG_RUNTIME_DIR}/containers"

  # oc-mirror and skopeo read auth from ${XDG_RUNTIME_DIR}/containers/auth.json
  cp "${MIRROR_REGISTRY_PULL_SECRET}" "${XDG_RUNTIME_DIR}/containers/auth.json"

  # REGISTRY_AUTH_FILE is respected by skopeo as an explicit override
  export REGISTRY_AUTH_FILE="${MIRROR_REGISTRY_PULL_SECRET}"

  # oc-mirror requires this to be unset
  unset REGISTRY_AUTH_PREFERENCE

  log::info "Container auth configured from ${MIRROR_REGISTRY_PULL_SECRET}"
}

# Build an ImageSetConfiguration for oc-mirror.
# The configuration is dynamically generated based on IMAGE_REGISTRY:
#   - registry.redhat.io (GA): uses helm.local with chart pulled from charts.openshift.io
#   - anything else (CI/upstream): uses helm.local with chart pulled from OCI
# Args:
#   $1 - output_path: Path to write the ImageSetConfiguration YAML
disconnected::build_imageset_config() {
  local output_path=$1

  # Start with the base config
  cat > "${output_path}" << EOF
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  helm:
    local:
      - name: redhat-developer-hub
        path: ${CHART_LOCAL_TGZ}
EOF

  # Add additional images that need mirroring beyond what the chart references.
  # The chart's default images are discovered automatically by oc-mirror.
  local additional_images=()

  # When the hub image is overridden (different from chart defaults), add it
  # so oc-mirror mirrors the actual image we'll deploy with.
  if [[ "${IMAGE_REGISTRY}" != "registry.redhat.io" ]]; then
    # CI/upstream: chart defaults to quay.io/rhdh/rhdh-hub-rhel9@sha256:...,
    # but we may deploy with a different tag (e.g., rhdh-community/rhdh:next)
    additional_images+=("${IMAGE_REGISTRY}/${IMAGE_REPO}:${TAG_NAME}")
  fi

  # PG image: CI charts may use quay.io/fedora/postgresql-15 instead of
  # registry.redhat.io/rhel9/postgresql-15. Add it if not from registry.redhat.io.
  # PG_SEPARATOR accounts for digest (@sha256:) vs tag (:) encoding.
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

# Run a command with REGISTRY_AUTH_FILE unset, then restore it.
# oc-mirror (and prepare paths that invoke it) panic when REGISTRY_AUTH_FILE
# is set because distribution/distribution treats it as a storage driver
# config. Auth still comes from ${XDG_RUNTIME_DIR}/containers/auth.json
# (configured by disconnected::setup_auth).
disconnected::with_unset_registry_auth_file() {
  local saved_registry_auth_file="${REGISTRY_AUTH_FILE:-}"
  unset REGISTRY_AUTH_FILE

  local rc=0
  "$@" || rc=$?

  if [[ -n "${saved_registry_auth_file}" ]]; then
    export REGISTRY_AUTH_FILE="${saved_registry_auth_file}"
  fi
  return "${rc}"
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

  log::info "Running oc-mirror --v2 → ${MIRROR_REGISTRY_URL}"
  if ! disconnected::with_unset_registry_auth_file oc-mirror \
    -c "${imageset_config}" \
    "docker://${MIRROR_REGISTRY_URL}" \
    --dest-tls-verify=false \
    --v2 \
    --workspace "file://${workspace_dir}"; then
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

  # Chart path (in the workspace)
  OC_MIRROR_CHART_PATH=$(find "${result_dir}/helm/charts" -name '*.tgz' 2> /dev/null | head -1)
  export OC_MIRROR_CHART_PATH

  log::success "oc-mirror completed successfully"
  log::info "IDMS: ${OC_MIRROR_IDMS_FILE}"
  [[ -n "${OC_MIRROR_ITMS_FILE}" ]] && log::info "ITMS: ${OC_MIRROR_ITMS_FILE}"
  [[ -n "${OC_MIRROR_CHART_PATH}" ]] && log::info "Chart: ${OC_MIRROR_CHART_PATH}"

  # Save artifacts for debugging
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

  # Add mirror entries for the hub image from both registries
  for source_registry in "quay.io" "registry.redhat.io"; do
    local source="${source_registry}/${IMAGE_REPO}"
    local mirror="${MIRROR_REGISTRY_URL}/${IMAGE_REPO}"

    # Skip if this source is already in the IDMS
    if yq eval ".spec.imageDigestMirrors[].source" "${idms_file}" 2> /dev/null | grep -qF "${source}"; then
      log::debug "IDMS already contains entry for ${source}"
      continue
    fi

    yq eval -i \
      ".spec.imageDigestMirrors += [{\"mirrors\": [\"${mirror}\"], \"source\": \"${source}\"}]" \
      "${idms_file}"
    log::info "Added IDMS entry: ${source} → ${mirror}"
  done

  # Add mirror entry for PG image if not already present.
  # PG_REPO is already cleaned of @sha256 by the caller (via PG_SEPARATOR).
  if [[ -n "${PG_REGISTRY:-}" && -n "${PG_REPO:-}" ]]; then
    local pg_source="${PG_REGISTRY}/${PG_REPO}"
    local pg_mirror="${MIRROR_REGISTRY_URL}/${PG_REPO}"

    if ! yq eval ".spec.imageDigestMirrors[].source" "${idms_file}" 2> /dev/null | grep -qF "${pg_source}"; then
      yq eval -i \
        ".spec.imageDigestMirrors += [{\"mirrors\": [\"${pg_mirror}\"], \"source\": \"${pg_source}\"}]" \
        "${idms_file}"
      log::info "Added IDMS entry: ${pg_source} → ${pg_mirror}"
    fi
  fi

  log::debug "Patched IDMS:"
  log::debug "$(cat "${idms_file}")"

  cp "${idms_file}" "${ARTIFACT_DIR}/disconnected-idms-patched.yaml" 2> /dev/null || true
}

# Fetch an external script from the rhdh-operator repository.
# Args:
#   $1 - script_name: Name of the script (e.g., "mirror-plugins.sh")
#   $2 - output_path: Local path to save the script
#   $3 - ref: (optional) Branch name or 40-char commit SHA
#             (defaults to $RELEASE_BRANCH_NAME)
disconnected::fetch_script() {
  local script_name=$1
  local output_path=$2
  local ref="${3:-${RELEASE_BRANCH_NAME}}"
  local url
  local ref_label

  if [[ "${ref}" =~ ^[0-9a-f]{40}$ ]]; then
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/${ref}/.rhdh/scripts/${script_name}"
    ref_label="sha: ${ref}"
  else
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${ref}/.rhdh/scripts/${script_name}"
    ref_label="branch: ${ref}"
  fi

  log::info "Fetching ${script_name} from rhdh-operator (${ref_label})..."
  if ! curl -fL --max-time 30 -o "${output_path}" "${url}"; then
    log::error "Failed to download ${script_name} from ${url}"
    return 1
  fi
  chmod +x "${output_path}"
  log::success "Downloaded ${script_name} to ${output_path}"
}

# Wait for MachineConfigPool updates after IDMS/CatalogSource changes.
# Warns and continues on timeout (same behavior as both handlers historically).
disconnected::wait_mcp_updated() {
  log::info "Waiting for MachineConfigPool updates to complete (up to 20m)..."
  if ! oc wait machineconfigpool --all --for=condition=Updated=True --timeout=20m; then
    log::warn "MachineConfigPool wait timed out — proceeding anyway"
  fi
  log::success "All MachineConfigPools are Updated"
}

# Fetch and run mirror-plugins.sh against the disconnected mirror registry.
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

  bash "${mirror_script}" \
    --plugin-index "${plugin_index}" \
    --to-registry "${MIRROR_REGISTRY_URL}" || {
    log::error "mirror-plugins.sh failed — aborting"
    return 1
  }
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

# Merge mirror-registry credentials into openshift-config/pull-secret so OLM v1
# catalogd/operator-controller can pull mirrored catalog/bundle images.
# prepare-restricted-environment.sh skips this for external registries.
disconnected::ensure_olm_mirror_pull_secret() {
  local existing mirror_auth merged

  existing=$(oc get secret pull-secret -n openshift-config -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d) || {
    log::error "Failed to read openshift-config/pull-secret"
    return 1
  }
  mirror_auth=$(cat "${MIRROR_REGISTRY_PULL_SECRET}") || {
    log::error "Failed to read ${MIRROR_REGISTRY_PULL_SECRET}"
    return 1
  }

  merged=$(jq -n --argjson existing "${existing}" --argjson mirror "${mirror_auth}" \
    '{auths: ($existing.auths + $mirror.auths)}') || {
    log::error "Failed to merge mirror credentials into pull-secret JSON"
    return 1
  }

  echo "${merged}" | oc set data secret/pull-secret -n openshift-config \
    --from-file=.dockerconfigjson=/dev/stdin || {
    log::error "Failed to update openshift-config/pull-secret with mirror credentials"
    return 1
  }
  log::success "Merged mirror registry credentials into openshift-config/pull-secret"
}

# Dump OLM v1 install status for debugging when the operator CRD never appears.
disconnected::dump_olm_v1_status() {
  local extension_name=${1:-rhdh-operator}
  local catalog_name=${2:-rhdh-catalog}
  local operator_ns=${3:-rhdh-operator}

  log::info "Dumping OLM v1 status (ClusterCatalog/ClusterExtension/pods)..."
  oc get clustercatalog "${catalog_name}" -o yaml > "${ARTIFACT_DIR}/disconnected-clustercatalog.yaml" 2> /dev/null || true
  oc get clusterextension "${extension_name}" -o yaml > "${ARTIFACT_DIR}/disconnected-clusterextension.yaml" 2> /dev/null || true
  oc get clustercatalog "${catalog_name}" -o wide 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc get clusterextension "${extension_name}" -o wide 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc describe clusterextension "${extension_name}" 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc get pods -n "${operator_ns}" -o wide 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc get events -n "${operator_ns}" --sort-by='.lastTimestamp' 2>&1 | tail -50 \
    | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
}

# Wait for OLM v1 ClusterExtension to report Installed, then for the CRD.
# Args:
#   $1 - extension name (default: rhdh-operator)
#   $2 - crd name (default: backstages.rhdh.redhat.com)
#   $3 - timeout seconds (default: 600)
disconnected::wait_operator_crd_olm_v1() {
  local extension_name=${1:-rhdh-operator}
  local crd_name=${2:-backstages.rhdh.redhat.com}
  local timeout=${3:-600}
  local interval=15
  local elapsed=0

  log::info "Waiting for ClusterExtension/${extension_name} and CRD ${crd_name} (timeout: ${timeout}s)..."

  while ((elapsed < timeout)); do
    if oc get crd "${crd_name}" > /dev/null 2>&1; then
      log::success "CRD '${crd_name}' is available"
      return 0
    fi

    local installed
    installed=$(oc get clusterextension "${extension_name}" \
      -o jsonpath='{range .status.conditions[?(@.type=="Installed")]}{.status}{end}' 2> /dev/null || true)
    if [[ "${installed}" == "True" ]]; then
      log::info "ClusterExtension/${extension_name} reports Installed=True; waiting for CRD..."
    else
      local progressing reason
      progressing=$(oc get clusterextension "${extension_name}" \
        -o jsonpath='{range .status.conditions[?(@.type=="Progressing")]}{.status}{end}' 2> /dev/null || true)
      reason=$(oc get clusterextension "${extension_name}" \
        -o jsonpath='{range .status.conditions[?(@.type=="Installed")]}{.reason}{" "}{.message}{end}' 2> /dev/null || true)
      log::debug "ClusterExtension Installed=${installed:-unknown} Progressing=${progressing:-unknown} ${reason}"
    fi

    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done

  log::error "Timeout waiting for CRD '${crd_name}' after ${timeout}s"
  disconnected::dump_olm_v1_status "${extension_name}"
  return 1
}

# Export functions for subshell usage (e.g., timeout bash -c "...")
export -f disconnected::require_env
export -f disconnected::setup_auth
export -f disconnected::fetch_script
export -f disconnected::with_unset_registry_auth_file
export -f disconnected::wait_mcp_updated
export -f disconnected::mirror_plugins
export -f disconnected::apply_plugin_mirror_configmap
export -f disconnected::ensure_olm_mirror_pull_secret
export -f disconnected::dump_olm_v1_status
export -f disconnected::wait_operator_crd_olm_v1
