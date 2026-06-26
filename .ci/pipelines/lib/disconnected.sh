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

# oc-mirror binary path, set by disconnected::install_oc_mirror.
OC_MIRROR_BIN=""
export OC_MIRROR_BIN

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

# Download the oc-mirror binary at runtime from mirror.openshift.com.
# Uses CONTAINER_PLATFORM_VERSION to select the matching version.
disconnected::install_oc_mirror() {
  local arch
  arch=$(uname -m)
  case ${arch} in
    x86_64) arch="amd64" ;;
    aarch64) arch="arm64" ;;
  esac

  local ocp_version="${CONTAINER_PLATFORM_VERSION:-4.21}"
  local oc_mirror_version=""

  # Try stable channel for the OCP minor version, fall back to latest
  local stable_url="https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/stable-${ocp_version}/"
  if curl -sf --head --connect-timeout 10 "${stable_url}" > /dev/null 2>&1; then
    oc_mirror_version="stable-${ocp_version}"
    log::info "Using oc-mirror from stable-${ocp_version} channel"
  else
    oc_mirror_version="latest"
    log::info "stable-${ocp_version} not available, using oc-mirror from latest channel"
  fi

  local download_dir="${DISCONNECTED_TMPDIR}/oc-mirror-download"
  mkdir -p "${download_dir}"

  local base_url="https://mirror.openshift.com/pub/openshift-v4/${arch}/clients/ocp/${oc_mirror_version}"

  log::info "Downloading oc-mirror from ${base_url}/"
  if ! curl -fL --retry 5 --connect-timeout 30 -o "${download_dir}/oc-mirror.tar.gz" "${base_url}/oc-mirror.tar.gz"; then
    log::error "Failed to download oc-mirror"
    return 1
  fi

  # Verify checksum
  if curl -fL --retry 3 --connect-timeout 30 -o "${download_dir}/sha256sum.txt" "${base_url}/sha256sum.txt" 2> /dev/null; then
    if grep "oc-mirror.tar.gz" "${download_dir}/sha256sum.txt" | (cd "${download_dir}" && sha256sum -c -); then
      log::info "oc-mirror checksum verified"
    else
      log::warn "oc-mirror checksum verification failed — continuing anyway"
    fi
  fi

  tar -xzf "${download_dir}/oc-mirror.tar.gz" -C "${download_dir}"
  chmod +x "${download_dir}/oc-mirror"
  OC_MIRROR_BIN="${download_dir}/oc-mirror"
  export OC_MIRROR_BIN

  log::success "oc-mirror installed: $(${OC_MIRROR_BIN} version --output=yaml 2>&1 | head -1)"
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
  if [[ "${PG_REGISTRY:-registry.redhat.io}" != "registry.redhat.io" ]]; then
    additional_images+=("${PG_REGISTRY}/${PG_REPO}:${PG_TAG}")
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
  if ! "${OC_MIRROR_BIN}" \
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

  # Add mirror entry for PG image if not already present
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
}

# Fetch an external script from the rhdh-operator repository.
# Args:
#   $1 - script_name: Name of the script (e.g., "mirror-plugins.sh")
#   $2 - output_path: Local path to save the script
#   $3 - branch: (optional) Branch name (defaults to $RELEASE_BRANCH_NAME)
disconnected::fetch_script() {
  local script_name=$1
  local output_path=$2
  local branch="${3:-${RELEASE_BRANCH_NAME}}"

  local url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${branch}/.rhdh/scripts/${script_name}"

  log::info "Fetching ${script_name} from rhdh-operator (branch: ${branch})..."
  if ! curl -fL --max-time 30 -o "${output_path}" "${url}"; then
    log::error "Failed to download ${script_name} from ${url}"
    return 1
  fi
  chmod +x "${output_path}"
  log::success "Downloaded ${script_name} to ${output_path}"
}

# Export functions for subshell usage (e.g., timeout bash -c "...")
export -f disconnected::require_env
export -f disconnected::setup_auth
export -f disconnected::fetch_script
