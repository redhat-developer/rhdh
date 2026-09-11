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
  elif [[ -f "${script_dir}/../../rhdh-e2e-test-utils/dist/secrets/cli.js" ]] && \
    local_cli=$(command -v node 2> /dev/null); then
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

local_secrets::require_metadata_support() {
  local help

  if ! help=$("${LOCAL_SECRETS_CLI[@]}" --help 2>&1); then
    printf 'Unable to query rhdh-e2e-secrets capabilities\n' >&2
    return 1
  fi
  if [[ "$help" != *"--expose-secret-names"* ]]; then
    printf 'rhdh-e2e-secrets must support --expose-secret-names\n' >&2
    return 1
  fi
}

local_secrets::validate_secret_names() {
  local metadata=${1:?"Secret metadata is required"}
  local name

  if ! printf '%s' "$metadata" | jq -e \
    'type == "array" and length > 0 and all(.[]; type == "string") and (length == (unique | length))' \
    > /dev/null; then
    printf 'RHDH_E2E_SECRET_NAMES must be a non-empty JSON array of unique names\n' >&2
    return 1
  fi

  while IFS= read -r name; do
    if [[ ! "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      printf 'Invalid secret environment name in metadata\n' >&2
      return 1
    fi
    case "$name" in
      BW_* | VAULT* | RHDH_E2E_SECRET_NAMES)
        printf 'Provider environment name is not allowed in metadata\n' >&2
        return 1
        ;;
    esac
  done < <(printf '%s' "$metadata" | jq -r '.[]')
}
