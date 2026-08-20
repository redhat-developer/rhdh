#!/usr/bin/env bash
# Fetching helper scripts from the rhdh-operator repository (.rhdh/scripts).

[[ -n "${_DISCONNECTED_SCRIPTS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_SCRIPTS_SOURCED=1

# Download a helper script from redhat-developer/rhdh-operator's .rhdh/scripts
# directory (e.g. mirror-plugins.sh, prepare-restricted-environment.sh).
# Args:
#   $1 - script_name: file under .rhdh/scripts/ to fetch
#   $2 - output_path: local path to write the (executable) script to
#   $3 - ref (optional): 40-char commit sha, "pull/<n>[/head]", or a branch name.
#        Defaults to RELEASE_BRANCH_NAME.
disconnected::fetch_operator_repo_script() {
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
