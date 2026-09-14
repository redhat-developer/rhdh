#!/usr/bin/env bash

if [[ -n "${RHDH_SECRETS_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_SECRETS_LIB_SOURCED=1

secrets::_environment_name() {
  local name=$1
  name=${name//./_}
  name=${name//-/_}
  name=${name//\//_}
  printf '%s\n' "$name"
}

secrets::_is_dangerous_environment_name() {
  case "$1" in
    BASH | BASH_* | BASHOPTS | BASHPID | CDPATH | DYLD_* | DIRSTACK | \
      ENV | EUID | FUNCNAME | GLOBIGNORE | GROUPS | HOME | HOSTTYPE | IFS | \
      LD_* | LINENO | MACHTYPE | OLDPWD | OPTIND | OSTYPE | PATH | \
      POSIXLY_CORRECT | PPID | PROMPT_COMMAND | PS4 | PWD | RANDOM | SECONDS | \
      SHELL | SHELLOPTS | SHLVL | UID)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

secrets::_resolved_path() {
  local root=$1
  local path=$2
  local target directory
  local -i attempt

  root=$(cd -P -- "$root" 2> /dev/null && pwd) || return 1

  for ((attempt = 0; attempt < 40; attempt++)); do
    if [[ -L "$path" ]]; then
      target=$(readlink "$path") || return 1
      if [[ "$target" == /* ]]; then
        path=$target
      else
        path="$(dirname "$path")/${target}"
      fi
      continue
    fi

    directory=$(cd -P -- "$(dirname "$path")" 2> /dev/null && pwd) || return 1
    path="${directory}/$(basename "$path")"
    case "$path" in
      "$root"/*)
        printf '%s\n' "$path"
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  done

  return 1
}

secrets::_is_safe_entry() {
  local root=$1
  local path=$2
  local resolved

  root=$(cd -P -- "$root" 2> /dev/null && pwd) || return 1
  [[ -e "$path" || -L "$path" ]] || return 1
  resolved=$(secrets::_resolved_path "$root" "$path") || return 1
  [[ "$resolved" == "$root"/* ]] && [[ -e "$resolved" ]]
}

secrets::_is_safe_file() {
  local root=$1
  local path=$2

  secrets::_is_safe_entry "$root" "$path" && [[ -f "$path" ]]
}

secrets::_is_file_exception() {
  case "$1" in
    azure-db-certificates.pem | azure-db-certificates--dot--pem | \
      rds-db-certificates.pem | rds-db-certificates--dot--pem)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

secrets::load_directory() {
  local __RHDH_SECRETS_DIRECTORY=${1:?"Secret directory is required"}
  local __RHDH_SECRETS_ROOT __RHDH_SECRETS_FILE __RHDH_SECRETS_KEY
  local __RHDH_SECRETS_ENVIRONMENT_NAME __RHDH_SECRETS_EXISTING
  local __RHDH_SECRETS_VALUE __RHDH_SECRETS_DECLARATION
  local -a __RHDH_SECRETS_FILES=() __RHDH_SECRETS_ENVIRONMENT_NAMES=()
  local -a __RHDH_SECRETS_VALUES=()

  if [[ ! -e "$__RHDH_SECRETS_DIRECTORY" && ! -L "$__RHDH_SECRETS_DIRECTORY" ]]; then
    return 0
  fi
  [[ -d "$__RHDH_SECRETS_DIRECTORY" ]] || {
    printf 'Secret path is not a directory: %s\n' "$__RHDH_SECRETS_DIRECTORY" >&2
    return 1
  }
  __RHDH_SECRETS_ROOT=$(cd -P -- "$__RHDH_SECRETS_DIRECTORY" 2> /dev/null && pwd) || {
    printf 'Unable to access secret directory: %s\n' "$__RHDH_SECRETS_DIRECTORY" >&2
    return 1
  }

  for __RHDH_SECRETS_FILE in "$__RHDH_SECRETS_DIRECTORY"/* \
    "$__RHDH_SECRETS_DIRECTORY"/.[!.]* "$__RHDH_SECRETS_DIRECTORY"/..?*; do
    [[ -e "$__RHDH_SECRETS_FILE" || -L "$__RHDH_SECRETS_FILE" ]] || continue
    __RHDH_SECRETS_KEY=${__RHDH_SECRETS_FILE##*/}

    # Kubernetes projected Secret metadata and timestamp directories.
    if [[ "$__RHDH_SECRETS_KEY" == ..* ]]; then
      if [[ -L "$__RHDH_SECRETS_FILE" ]] \
        && ! secrets::_is_safe_entry "$__RHDH_SECRETS_ROOT" "$__RHDH_SECRETS_FILE"; then
        printf 'Invalid Kubernetes Secret metadata symlink: %s\n' \
          "$__RHDH_SECRETS_KEY" >&2
        return 1
      fi
      continue
    fi
    if [[ -L "$__RHDH_SECRETS_FILE" ]]; then
      if ! secrets::_is_safe_file "$__RHDH_SECRETS_ROOT" "$__RHDH_SECRETS_FILE"; then
        printf 'Invalid Secret symlink: %s\n' "$__RHDH_SECRETS_KEY" >&2
        return 1
      fi
    elif [[ -f "$__RHDH_SECRETS_FILE" ]]; then
      if ! secrets::_is_safe_file "$__RHDH_SECRETS_ROOT" "$__RHDH_SECRETS_FILE"; then
        printf 'Secret file escapes its directory: %s\n' "$__RHDH_SECRETS_KEY" >&2
        return 1
      fi
    else
      continue
    fi
    secrets::_is_file_exception "$__RHDH_SECRETS_KEY" && continue

    __RHDH_SECRETS_ENVIRONMENT_NAME=$(secrets::_environment_name "$__RHDH_SECRETS_KEY")
    if [[ ! "$__RHDH_SECRETS_ENVIRONMENT_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      printf 'Invalid Secret environment name: %s\n' "$__RHDH_SECRETS_KEY" >&2
      return 1
    fi
    if [[ "$__RHDH_SECRETS_ENVIRONMENT_NAME" == __RHDH_SECRETS_* ]]; then
      printf 'Reserved Secret environment name: %s\n' "$__RHDH_SECRETS_KEY" >&2
      return 1
    fi
    if secrets::_is_dangerous_environment_name "$__RHDH_SECRETS_ENVIRONMENT_NAME"; then
      printf 'Refusing dangerous Secret environment name: %s\n' "$__RHDH_SECRETS_KEY" >&2
      return 1
    fi

    if [[ "${#__RHDH_SECRETS_ENVIRONMENT_NAMES[@]}" -gt 0 ]]; then
      for __RHDH_SECRETS_EXISTING in \
        "${__RHDH_SECRETS_ENVIRONMENT_NAMES[@]}"; do
        if [[ "$__RHDH_SECRETS_EXISTING" == "$__RHDH_SECRETS_ENVIRONMENT_NAME" ]]; then
          printf 'Secret environment name collision: %s\n' \
            "$__RHDH_SECRETS_ENVIRONMENT_NAME" >&2
          return 1
        fi
      done
    fi

    __RHDH_SECRETS_FILES+=("$__RHDH_SECRETS_FILE")
    __RHDH_SECRETS_ENVIRONMENT_NAMES+=("$__RHDH_SECRETS_ENVIRONMENT_NAME")
  done

  local __RHDH_SECRETS_INDEX
  if [[ "${#__RHDH_SECRETS_FILES[@]}" -gt 0 ]]; then
    for __RHDH_SECRETS_INDEX in "${!__RHDH_SECRETS_FILES[@]}"; do
      # Secret stream values cannot contain NUL bytes. Unlike command
      # substitution, read preserves trailing newlines until that delimiter.
      IFS= read -r -d '' __RHDH_SECRETS_VALUE \
        < "${__RHDH_SECRETS_FILES[__RHDH_SECRETS_INDEX]}" || true
      __RHDH_SECRETS_VALUES+=("$__RHDH_SECRETS_VALUE")
    done

    for __RHDH_SECRETS_ENVIRONMENT_NAME in \
      "${__RHDH_SECRETS_ENVIRONMENT_NAMES[@]}"; do
      if __RHDH_SECRETS_DECLARATION=$(declare -p "$__RHDH_SECRETS_ENVIRONMENT_NAME" \
        2> /dev/null) \
        && [[ "$__RHDH_SECRETS_DECLARATION" =~ ^declare[[:space:]]+-[^[:space:]]*r ]]; then
        printf 'Refusing readonly Secret environment name: %s\n' \
          "$__RHDH_SECRETS_ENVIRONMENT_NAME" >&2
        return 1
      fi
    done

    for __RHDH_SECRETS_INDEX in "${!__RHDH_SECRETS_ENVIRONMENT_NAMES[@]}"; do
      if ! printf -v "${__RHDH_SECRETS_ENVIRONMENT_NAMES[__RHDH_SECRETS_INDEX]}" '%s' \
        "${__RHDH_SECRETS_VALUES[__RHDH_SECRETS_INDEX]}"; then
        printf 'Unable to assign Secret environment name: %s\n' \
          "${__RHDH_SECRETS_ENVIRONMENT_NAMES[__RHDH_SECRETS_INDEX]}" >&2
        return 1
      fi
      export "${__RHDH_SECRETS_ENVIRONMENT_NAMES[__RHDH_SECRETS_INDEX]}"
    done
  fi
}

secrets::file_path() {
  local directory=${1:?"Secret directory is required"}
  local name=${2:?"Secret file name is required"}
  local candidate path found=''
  local -a candidates=("$name")

  case "$name" in
    azure-db-certificates.pem)
      candidates+=(azure-db-certificates--dot--pem)
      ;;
    rds-db-certificates.pem)
      candidates+=(rds-db-certificates--dot--pem)
      ;;
  esac

  [[ "$name" != */* && "$name" != . && "$name" != .. ]] || return 1
  [[ -d "$directory" ]] || return 1

  for candidate in "${candidates[@]}"; do
    path="${directory}/${candidate}"
    if [[ -e "$path" || -L "$path" ]]; then
      if ! secrets::_is_safe_entry "$directory" "$path" || [[ ! -f "$path" ]]; then
        printf 'Secret file escapes its directory: %s\n' "$candidate" >&2
        return 1
      fi
      if [[ -n "$found" ]]; then
        printf 'Ambiguous Secret file names: %s and %s\n' "$found" "$candidate" >&2
        return 1
      fi
      found=$path
    fi
  done

  [[ -n "$found" ]] || return 1
  printf '%s\n' "$found"
}

secrets::file_from_environment() {
  local __RHDH_SECRETS_DIRECTORY=${1:?"Secret directory is required"}
  local __RHDH_SECRETS_SOURCE=${2:?"Secret environment name is required"}
  local __RHDH_SECRETS_FILENAME=${3:?"Secret file name is required"}
  local __RHDH_SECRETS_PATH

  [[ "$__RHDH_SECRETS_SOURCE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  [[ "$__RHDH_SECRETS_FILENAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
  [[ -n "${!__RHDH_SECRETS_SOURCE+x}" ]] || return 1

  __RHDH_SECRETS_PATH="${__RHDH_SECRETS_DIRECTORY}/${__RHDH_SECRETS_FILENAME}"
  if ! (
    local __RHDH_SECRETS_TEMP_PATH
    umask 077
    mkdir -p "$__RHDH_SECRETS_DIRECTORY" || exit 1
    __RHDH_SECRETS_TEMP_PATH=$(mktemp \
      "${__RHDH_SECRETS_DIRECTORY}/.rhdh-secret.XXXXXX") || exit 1
    [[ ! -d "$__RHDH_SECRETS_PATH" ]] || exit 1
    trap 'rm -f "$__RHDH_SECRETS_TEMP_PATH"' EXIT
    printf '%s' "${!__RHDH_SECRETS_SOURCE}" > "$__RHDH_SECRETS_TEMP_PATH" || exit 1
    chmod 600 "$__RHDH_SECRETS_TEMP_PATH" || exit 1
    mv -f "$__RHDH_SECRETS_TEMP_PATH" "$__RHDH_SECRETS_PATH" || exit 1
    trap - EXIT
  ); then
    printf 'Unable to materialize Secret file: %s\n' "$__RHDH_SECRETS_FILENAME" >&2
    return 1
  fi
  printf '%s\n' "$__RHDH_SECRETS_PATH"
}

secrets::alias() {
  local __RHDH_SECRETS_TARGET=${1:?"Secret alias target is required"}
  local __RHDH_SECRETS_SOURCE=${2:?"Secret alias source is required"}
  local __RHDH_SECRETS_VALUE

  [[ -n "${!__RHDH_SECRETS_SOURCE+x}" ]] || return 0
  __RHDH_SECRETS_VALUE=${!__RHDH_SECRETS_SOURCE}
  if ! printf -v "$__RHDH_SECRETS_TARGET" '%s' "$__RHDH_SECRETS_VALUE"; then
    printf 'Unable to assign Secret alias: %s\n' "$__RHDH_SECRETS_TARGET" >&2
    return 1
  fi
  # shellcheck disable=SC2163
  export "$__RHDH_SECRETS_TARGET"
}

secrets::apply_common_aliases() {
  secrets::alias RHBK_BASE_URL AUTH_PROVIDERS_RHBK_BASE_URL
  secrets::alias RHBK_CLIENT_SECRET AUTH_PROVIDERS_RHBK_CLIENT_SECRET
  secrets::alias RHBK_CLIENT_ID AUTH_PROVIDERS_RHBK_CLIENT_ID
  secrets::alias RHBK_REALM AUTH_PROVIDERS_RHBK_REALM
  secrets::alias DEFAULT_USER_PASSWORD AUTH_PROVIDERS_DEFAULT_USER_PASSWORD
  secrets::alias DEFAULT_USER_PASSWORD_2 AUTH_PROVIDERS_DEFAULT_USER_PASSWORD_2
}

secrets::prepare_database_certificates() {
  local __RHDH_SECRETS_MOUNT_DIRECTORY=${1:?"Secret mount directory is required"}
  local __RHDH_SECRETS_RUNTIME_DIRECTORY=${2:?"Secret runtime directory is required"}
  local __RHDH_SECRETS_CERTIFICATE_PATH

  if [[ -d "$__RHDH_SECRETS_MOUNT_DIRECTORY" ]] \
    && __RHDH_SECRETS_CERTIFICATE_PATH=$(secrets::file_path \
      "$__RHDH_SECRETS_MOUNT_DIRECTORY" rds-db-certificates.pem); then
    RDS_DB_CERTIFICATES_PATH=$__RHDH_SECRETS_CERTIFICATE_PATH
    export RDS_DB_CERTIFICATES_PATH
  elif [[ -n "${rds_db_certificates_pem+x}" ]]; then
    RDS_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
      "$__RHDH_SECRETS_RUNTIME_DIRECTORY" rds_db_certificates_pem \
      rds-db-certificates.pem)
    export RDS_DB_CERTIFICATES_PATH
  elif [[ -n "${rds_db_certificates__dot__pem+x}" ]]; then
    RDS_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
      "$__RHDH_SECRETS_RUNTIME_DIRECTORY" rds_db_certificates__dot__pem \
      rds-db-certificates.pem)
    export RDS_DB_CERTIFICATES_PATH
  fi

  if [[ -d "$__RHDH_SECRETS_MOUNT_DIRECTORY" ]] \
    && __RHDH_SECRETS_CERTIFICATE_PATH=$(secrets::file_path \
      "$__RHDH_SECRETS_MOUNT_DIRECTORY" azure-db-certificates.pem); then
    AZURE_DB_CERTIFICATES_PATH=$__RHDH_SECRETS_CERTIFICATE_PATH
    export AZURE_DB_CERTIFICATES_PATH
  elif [[ -n "${azure_db_certificates_pem+x}" ]]; then
    AZURE_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
      "$__RHDH_SECRETS_RUNTIME_DIRECTORY" azure_db_certificates_pem \
      azure-db-certificates.pem)
    export AZURE_DB_CERTIFICATES_PATH
  elif [[ -n "${azure_db_certificates__dot__pem+x}" ]]; then
    AZURE_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
      "$__RHDH_SECRETS_RUNTIME_DIRECTORY" azure_db_certificates__dot__pem \
      azure-db-certificates.pem)
    export AZURE_DB_CERTIFICATES_PATH
  fi
}
