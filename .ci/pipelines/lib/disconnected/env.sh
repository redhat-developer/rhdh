#!/usr/bin/env bash
# Environment validation, container auth, and external script fetching.

[[ -n "${_DISCONNECTED_ENV_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_ENV_SOURCED=1

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

disconnected::fetch_script() {
  local script_name=$1
  local output_path=$2
  local ref="${3:-${RELEASE_BRANCH_NAME}}"
  local url
  local ref_label
  local pull_number

  if [[ "${ref}" =~ ^[0-9a-f]{40}$ ]]; then
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/${ref}/.rhdh/scripts/${script_name}"
    ref_label="sha: ${ref}"
  elif [[ "${ref}" =~ ^(refs/)?pull/([0-9]+)(/head)?$ ]]; then
    # Always the current PR head (updates as the PR is pushed).
    pull_number="${BASH_REMATCH[2]}"
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/pull/${pull_number}/head/.rhdh/scripts/${script_name}"
    ref_label="pull/${pull_number} head"
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
