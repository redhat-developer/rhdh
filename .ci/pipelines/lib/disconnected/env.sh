#!/usr/bin/env bash
# Environment validation and container auth for disconnected handlers.

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

  local auth_file="${XDG_RUNTIME_DIR}/containers/auth.json"
  local redhat_auth_file=""
  local merged_auth_file=""

  # oc-mirror and skopeo read auth from ${XDG_RUNTIME_DIR}/containers/auth.json
  install -m 600 "${MIRROR_REGISTRY_PULL_SECRET}" "${auth_file}"

  # The OpenShift CI rhdh credential bundle provides registry.redhat.io auth as
  # a base64-encoded dockerconfigjson. Merge it only into this private runtime
  # auth file so gated images (for example OKP) can be mirrored without ever
  # logging or persisting the credential. Local disconnected runs do not set
  # this variable and continue using MIRROR_REGISTRY_PULL_SECRET unchanged.
  if [[ -n "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON:-}" ]]; then
    redhat_auth_file=$(mktemp "${XDG_RUNTIME_DIR}/containers/redhat-auth.XXXXXX")
    merged_auth_file=$(mktemp "${XDG_RUNTIME_DIR}/containers/merged-auth.XXXXXX")

    if ! printf '%s' "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}" \
      | base64 -d > "${redhat_auth_file}" 2> /dev/null; then
      log::error "Could not decode the registry.redhat.io dockerconfigjson"
      rm -f "${redhat_auth_file}" "${merged_auth_file}"
      unset REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON
      return 1
    fi

    if ! jq -e '.auths | type == "object"' "${redhat_auth_file}" > /dev/null 2>&1; then
      log::error "The registry.redhat.io credential is not a valid dockerconfigjson"
      rm -f "${redhat_auth_file}" "${merged_auth_file}"
      unset REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON
      return 1
    fi

    if ! jq -s \
      '.[0] * {auths: ((.[0].auths // {}) + (.[1].auths // {}))}' \
      "${auth_file}" "${redhat_auth_file}" > "${merged_auth_file}"; then
      log::error "Could not merge registry.redhat.io auth into the runtime pull secret"
      rm -f "${redhat_auth_file}" "${merged_auth_file}"
      unset REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON
      return 1
    fi

    mv "${merged_auth_file}" "${auth_file}"
    rm -f "${redhat_auth_file}"
    unset REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON
    log::info "Added registry.redhat.io authentication to the private runtime auth file"
  fi

  chmod 600 "${auth_file}"

  # REGISTRY_AUTH_FILE is respected by skopeo as an explicit override
  export REGISTRY_AUTH_FILE="${auth_file}"

  # oc-mirror requires this to be unset
  unset REGISTRY_AUTH_PREFERENCE

  log::info "Container auth configured in ${auth_file}"
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
