#!/usr/bin/env bash

if [[ -n "${RHDH_LOCAL_SECRETS_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_LOCAL_SECRETS_LIB_SOURCED=1

local_secrets::resolve_cli() {
  local script_dir=${1:?"Script directory is required"}
  local local_cli
  LOCAL_SECRETS_CLI=()

  if [[ -n "${RHDH_E2E_SECRETS_BIN:-}" ]]; then
    if [[ -x "${RHDH_E2E_SECRETS_BIN}" ]]; then
      LOCAL_SECRETS_CLI=("${RHDH_E2E_SECRETS_BIN}")
    elif local_cli=$(command -v "${RHDH_E2E_SECRETS_BIN}" 2> /dev/null); then
      LOCAL_SECRETS_CLI=("${local_cli}")
    fi
  elif [[ -x "${script_dir}/node_modules/.bin/rhdh-e2e-secrets" ]]; then
    LOCAL_SECRETS_CLI=("${script_dir}/node_modules/.bin/rhdh-e2e-secrets")
  elif [[ -f "${script_dir}/../../rhdh-e2e-test-utils/dist/secrets/cli.js" ]] \
    && local_cli=$(command -v node 2> /dev/null); then
    LOCAL_SECRETS_CLI=(
      "${local_cli}"
      "${script_dir}/../../rhdh-e2e-test-utils/dist/secrets/cli.js"
    )
  elif local_cli=$(command -v rhdh-e2e-secrets 2> /dev/null); then
    LOCAL_SECRETS_CLI=("${local_cli}")
  fi

  if [[ "${#LOCAL_SECRETS_CLI[@]}" -eq 0 ]]; then
    printf 'Unable to find rhdh-e2e-secrets. Set RHDH_E2E_SECRETS_BIN or build the local test-utils checkout.\n' >&2
    return 1
  fi
}

local_secrets::require_stream_support() {
  local help

  if ! help=$("${LOCAL_SECRETS_CLI[@]}" --help 2>&1); then
    printf 'Unable to query rhdh-e2e-secrets capabilities\n' >&2
    return 1
  fi
  if [[ "$help" != *"--stream-secrets"* ]]; then
    printf 'rhdh-e2e-secrets must support --stream-secrets\n' >&2
    return 1
  fi
}

local_secrets::exec_with_stream() {
  local script_dir=${1:?'Script directory is required'}
  local profile=${2:?'Secret profile is required'}
  shift 2

  local_secrets::resolve_cli "$script_dir" || return 1
  local_secrets::require_stream_support || return 1
  if [[ -z "${BW_SESSION:-}" ]]; then
    printf 'BW_SESSION is required. Unlock Bitwarden before running this command.\n' >&2
    return 1
  fi
  if [[ ! -f "$profile" ]]; then
    printf 'Secret profile not found: %s\n' "$profile" >&2
    return 1
  fi
  if [[ $# -eq 0 ]]; then
    printf 'Wrapped command is required\n' >&2
    return 1
  fi

  exec "${LOCAL_SECRETS_CLI[@]}" exec \
    --profile "$profile" \
    --stream-secrets \
    -- "$@"
}

local_secrets::reexec_with_stream() {
  local script_dir=${1:?'Script directory is required'}
  local profile=${2:?'Secret profile is required'}
  local wrapped_variable=${3:?'Wrapper environment name is required'}
  shift 3

  [[ "$wrapped_variable" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    printf 'Invalid wrapper environment name\n' >&2
    return 1
  }
  if [[ "${!wrapped_variable:-}" == "1" ]]; then
    return 0
  fi

  printf -v "$wrapped_variable" '%s' 1
  # shellcheck disable=SC2163
  export "$wrapped_variable"
  local_secrets::exec_with_stream "$script_dir" "$profile" "$@"
}
