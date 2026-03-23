#!/bin/bash

# Prevent sourcing multiple times in the same shell.
if [[ -n "${RHDH_LOG_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_LOG_LIB_SOURCED=1

# Auto-detect TTY and disable colors if not in interactive terminal
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  : "${LOG_NO_COLOR:=false}"
else
  : "${LOG_NO_COLOR:=true}"
fi

: "${LOG_LEVEL:=INFO}"

log::timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log::level_value() {
  local level
  level="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
  case "${level}" in
    DEBUG) echo 0 ;;
    INFO) echo 1 ;;
    WARN | WARNING) echo 2 ;;
    ERROR | ERR) echo 3 ;;
    *) echo 1 ;;
  esac
}

log::should_log() {
  local requested_level
  local config_level
  requested_level="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
  config_level="$(echo "${LOG_LEVEL}" | tr '[:lower:]' '[:upper:]')"
  [[ "$(log::level_value "${requested_level}")" -ge "$(log::level_value "${config_level}")" ]]
}

log::reset_code() {
  if [[ "${LOG_NO_COLOR}" == "true" ]]; then
    printf ''
  else
    printf '\033[0m'
  fi
}

log::color_for_level() {
  if [[ "${LOG_NO_COLOR}" == "true" ]]; then
    printf ''
    return 0
  fi

  local level
  level="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
  case "${level}" in
    DEBUG) printf '\033[36m' ;;          # cyan
    INFO) printf '\033[34m' ;;           # blue
    WARN | WARNING) printf '\033[33m' ;; # yellow
    ERROR | ERR) printf '\033[31m' ;;    # red
    SUCCESS) printf '\033[32m' ;;        # green
    SECTION) printf '\033[35m\033[1m' ;; # magenta bold
    *) printf '\033[37m' ;;              # light gray
  esac
}

log::icon_for_level() {
  local level
  level="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
  case "${level}" in
    DEBUG) printf '🐞' ;;
    INFO) printf 'ℹ' ;;
    WARN | WARNING) printf '⚠' ;;
    ERROR | ERR) printf '❌' ;;
    SUCCESS) printf '✓' ;;
    SECTION) printf ' ' ;;
    *) printf '-' ;;
  esac
}

log::emit_line() {
  local level="$1"
  local icon="$2"
  local line="$3"
  local color reset timestamp

  if ! log::should_log "${level}"; then
    return 0
  fi

  timestamp="$(log::timestamp)"
  color="$(log::color_for_level "${level}")"
  reset="$(log::reset_code)"
  printf '%s[%s] %s %s%s\n' "${color}" "${timestamp}" "${icon}" "${line}" "${reset}" >&2
}

log::emit() {
  local level="$1"
  shift
  local icon
  icon="$(log::icon_for_level "${level}")"
  local message="${*:-}"

  if [[ -z "${message}" ]]; then
    return 0
  fi

  while IFS= read -r line; do
    log::emit_line "${level}" "${icon}" "${line}"
  done <<< "${message}"
}

log::debug() {
  log::emit "DEBUG" "$@"
}

log::info() {
  log::emit "INFO" "$@"
}

log::warn() {
  log::emit "WARN" "$@"
}

log::error() {
  log::emit "ERROR" "$@"
}

log::success() {
  log::emit "SUCCESS" "$@"
}

log::section() {
  local title="$*"
  log::hr
  log::emit "SECTION" "${title}"
  log::hr
}

log::hr() {
  local color reset
  color="$(log::color_for_level "SECTION")"
  reset="$(log::reset_code)"
  printf '%s%s%s\n' "${color}" "--------------------------------------------------------------------------------" "${reset}" >&2
}

# Export all log functions so they are available in subshells (e.g., timeout bash -c "...")
export -f log::timestamp
export -f log::level_value
export -f log::should_log
export -f log::reset_code
export -f log::color_for_level
export -f log::icon_for_level
export -f log::emit_line
export -f log::emit
export -f log::debug
export -f log::info
export -f log::warn
export -f log::error
export -f log::success
export -f log::section
export -f log::hr
