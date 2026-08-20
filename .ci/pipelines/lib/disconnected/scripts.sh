#!/usr/bin/env bash
# Fetching helper scripts from the rhdh-operator repository (.rhdh/scripts).

[[ -n "${_DISCONNECTED_SCRIPTS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_SCRIPTS_SOURCED=1

# Download a helper script from redhat-developer/rhdh-operator's .rhdh/scripts
# directory (e.g. mirror-plugins.sh, prepare-restricted-environment.sh) from the
# branch that matches RELEASE_BRANCH_NAME. RELEASE_BRANCH_NAME is always set by CI
# (from JOB_SPEC) and defaults to "main" for local runs (see env_variables.sh).
# Args:
#   $1 - script_name: file under .rhdh/scripts/ to fetch
#   $2 - output_path: local path to write the (executable) script to
disconnected::fetch_operator_repo_script() {
  local script_name=$1
  local output_path=$2
  local url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/${script_name}"

  log::info "Fetching ${script_name} from rhdh-operator (branch: ${RELEASE_BRANCH_NAME})..."
  if ! curl -fL --max-time 30 -o "${output_path}" "${url}"; then
    log::error "Failed to download ${script_name} from ${url}"
    return 1
  fi
  chmod +x "${output_path}"
  log::success "Downloaded ${script_name} to ${output_path}"
}
