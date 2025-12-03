#!/bin/bash

# Prevent sourcing multiple times in the same shell.
if [[ -n "${RHDH_LOGGING_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly RHDH_LOGGING_LIB_SOURCED=1

# Auto-detect TTY and disable colors if not in interactive terminal
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  : "${LOG_NO_COLOR:=false}"
else
  : "${LOG_NO_COLOR:=true}"
fi

: "${LOG_LEVEL:=INFO}"

logging::timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

logging::level_value() {
  local level="${1^^}"
  case "${level}" in
    DEBUG) echo 0 ;;
    INFO) echo 1 ;;
    WARN | WARNING) echo 2 ;;
    ERROR | ERR) echo 3 ;;
    *) echo 1 ;;
  esac
}

logging::should_log() {
  local requested_level="${1^^}"
  [[ "$(logging::level_value "${requested_level}")" -ge "$(logging::level_value "${LOG_LEVEL^^}")" ]]
}

logging::reset_code() {
  if [[ "${LOG_NO_COLOR}" == "true" ]]; then
    printf ''
  else
    printf '\033[0m'
  fi
}

logging::color_for_level() {
  if [[ "${LOG_NO_COLOR}" == "true" ]]; then
    printf ''
    return 0
  fi

  local level="${1^^}"
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

logging::icon_for_level() {
  local level="${1^^}"
  case "${level}" in
    DEBUG) printf '🐞' ;;
    INFO) printf 'ℹ️' ;;
    WARN | WARNING) printf '⚠️' ;;
    ERROR | ERR) printf '❌' ;;
    SUCCESS) printf '✅' ;;
    SECTION) printf '▪️' ;;
    *) printf '-' ;;
  esac
}

logging::emit_line() {
  local level="$1"
  local icon="$2"
  local line="$3"
  local color reset timestamp

  if ! logging::should_log "${level}"; then
    return 0
  fi

  timestamp="$(logging::timestamp)"
  color="$(logging::color_for_level "${level}")"
  reset="$(logging::reset_code)"
  printf '%s[%s] %s %s%s\n' "${color}" "${timestamp}" "${icon}" "${line}" "${reset}" >&2
}

logging::emit() {
  local level="$1"
  shift
  local icon
  icon="$(logging::icon_for_level "${level}")"
  local message="${*:-}"

  if [[ -z "${message}" ]]; then
    return 0
  fi

  while IFS= read -r line; do
    logging::emit_line "${level}" "${icon}" "${line}"
  done <<< "${message}"
}

logging::debug() {
  logging::emit "DEBUG" "$@"
}

logging::info() {
  logging::emit "INFO" "$@"
}

logging::warn() {
  logging::emit "WARN" "$@"
}

logging::error() {
  logging::emit "ERROR" "$@"
}

logging::success() {
  logging::emit "SUCCESS" "$@"
}

logging::section() {
  local title="$*"
  logging::hr
  logging::emit "SECTION" "${title}"
  logging::hr
}

logging::hr() {
  local color reset
  color="$(logging::color_for_level "SECTION")"
  reset="$(logging::reset_code)"
  printf '%s%s%s\n' "${color}" "--------------------------------------------------------------------------------" "${reset}" >&2
}
