#!/bin/bash
# Logging utilities for RHDH CI/CD Pipeline

# Prevent double sourcing
if [[ -n "${__CORE_LOGGING_SH_LOADED__:-}" ]]; then
  return 0
fi
export __CORE_LOGGING_SH_LOADED__=1

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# ============================================================================
# Color Definitions
# ============================================================================
# ANSI color codes for terminal output
export COLOR_RESET='\033[0m'
export COLOR_RED='\033[0;31m'
export COLOR_GREEN='\033[0;32m'
export COLOR_YELLOW='\033[0;33m'
export COLOR_BLUE='\033[0;34m'
export COLOR_MAGENTA='\033[0;35m'
export COLOR_CYAN='\033[0;36m'
export COLOR_BOLD='\033[1m'

# ============================================================================
# Logging Functions
# ============================================================================

# Log an info message
log_info() {
  local message="$1"
  echo -e "${COLOR_CYAN}[INFO]${COLOR_RESET} $(date '+%Y-%m-%d %H:%M:%S') - ${message}"
}

# Log a success message
log_success() {
  local message="$1"
  echo -e "${COLOR_GREEN}[SUCCESS]${COLOR_RESET} $(date '+%Y-%m-%d %H:%M:%S') - ${message}"
}

# Log a warning message
log_warning() {
  local message="$1"
  echo -e "${COLOR_YELLOW}[WARNING]${COLOR_RESET} $(date '+%Y-%m-%d %H:%M:%S') - ${message}"
}

# Log an error message
log_error() {
  local message="$1"
  echo -e "${COLOR_RED}[ERROR]${COLOR_RESET} $(date '+%Y-%m-%d %H:%M:%S') - ${message}" >&2
}

# Log a debug message (only if debug mode is enabled)
log_debug() {
  local message="$1"
  if [[ "${ISRUNNINGLOCALDEBUG:-false}" == "true" ]] || [[ "${DEBUG:-false}" == "true" ]]; then
    echo -e "${COLOR_MAGENTA}[DEBUG]${COLOR_RESET} $(date '+%Y-%m-%d %H:%M:%S') - ${message}"
  fi
}

# Log a section header
log_section() {
  local message="$1"
  echo ""
  echo -e "${COLOR_BOLD}${COLOR_BLUE}============================================================${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_BLUE} ${message}${COLOR_RESET}"
  echo -e "${COLOR_BOLD}${COLOR_BLUE}============================================================${COLOR_RESET}"
  echo ""
}

# Log a step within a section
log_step() {
  local step_number="$1"
  local message="$2"
  echo -e "${COLOR_BOLD}Step ${step_number}:${COLOR_RESET} ${message}"
}

# ============================================================================
# Command Execution with Logging
# ============================================================================

# Execute a command and log its output
# Usage: run_command "description" "command"
run_command() {
  local description="$1"
  local command="$2"
  
  log_info "Executing: ${description}"
  log_debug "Command: ${command}"
  
  if eval "${command}"; then
    log_success "${description} completed successfully"
    return 0
  else
    local exit_code=$?
    log_error "${description} failed with exit code ${exit_code}"
    return ${exit_code}
  fi
}

# Execute a command silently (no output unless it fails)
# Usage: run_silent "description" "command"
run_silent() {
  local description="$1"
  local command="$2"
  local temp_log="/tmp/run_silent_$$.log"
  
  log_debug "Executing silently: ${description}"
  
  if eval "${command}" > "${temp_log}" 2>&1; then
    rm -f "${temp_log}"
    return 0
  else
    local exit_code=$?
    log_error "${description} failed:"
    cat "${temp_log}" >&2
    rm -f "${temp_log}"
    return ${exit_code}
  fi
}

# ============================================================================
# Progress Indicators
# ============================================================================

# Show a spinner while a command is running
# Usage: run_with_spinner "description" "command"
run_with_spinner() {
  local description="$1"
  local command="$2"
  local spin_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local temp_log="/tmp/spinner_$$.log"
  
  log_info "${description}..."
  
  # Run command in background
  eval "${command}" > "${temp_log}" 2>&1 &
  local pid=$!
  
  # Show spinner while command is running
  local i=0
  while kill -0 ${pid} 2>/dev/null; do
    local char="${spin_chars:i++%${#spin_chars}:1}"
    printf "\r  ${char} Working..."
    sleep 0.1
  done
  
  # Get command exit code
  wait ${pid}
  local exit_code=$?
  
  printf "\r"
  
  if [[ ${exit_code} -eq 0 ]]; then
    log_success "${description} completed"
    rm -f "${temp_log}"
    return 0
  else
    log_error "${description} failed"
    cat "${temp_log}" >&2
    rm -f "${temp_log}"
    return ${exit_code}
  fi
}

# ============================================================================
# Timestamp Utilities
# ============================================================================

# Get current timestamp in ISO 8601 format
get_timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%S.%3NZ'
}

# Get timestamp for filenames (no special characters)
get_timestamp_filename() {
  date -u '+%Y%m%d-%H%M%S'
}

# Calculate duration between two timestamps
# Usage: calculate_duration start_time end_time
calculate_duration() {
  local start_time="$1"
  local end_time="$2"
  local duration=$((end_time - start_time))
  
  local hours=$((duration / 3600))
  local minutes=$(((duration % 3600) / 60))
  local seconds=$((duration % 60))
  
  printf "%02d:%02d:%02d" ${hours} ${minutes} ${seconds}
}

# ============================================================================
# Log File Management
# ============================================================================

# Initialize a log file for the current job
init_log_file() {
  local log_name="${1:-${LOGFILE}}"
  local log_dir="${ARTIFACT_DIR}"
  local log_path="${log_dir}/${log_name}"
  
  mkdir -p "${log_dir}"
  
  {
    echo "============================================================"
    echo "RHDH CI/CD Pipeline Log"
    echo "============================================================"
    echo "Job Name: ${JOB_NAME}"
    echo "Build ID: ${BUILD_ID}"
    echo "Start Time: $(get_timestamp)"
    echo "============================================================"
    echo ""
  } > "${log_path}"
  
  log_info "Log file initialized: ${log_path}"
  echo "${log_path}"
}

# Append message to log file
append_to_log() {
  local message="$1"
  local log_path="${2:-${ARTIFACT_DIR}/${LOGFILE}}"
  
  echo "[$(get_timestamp)] ${message}" >> "${log_path}"
}

# Save command output to log file
save_command_output() {
  local description="$1"
  local command="$2"
  local log_path="${3:-${ARTIFACT_DIR}/${LOGFILE}}"
  
  {
    echo ""
    echo "============================================================"
    echo "${description}"
    echo "Command: ${command}"
    echo "Time: $(get_timestamp)"
    echo "============================================================"
    eval "${command}" 2>&1
    echo ""
  } >> "${log_path}"
}

# ============================================================================
# Error Handling
# ============================================================================

# Set up error trap for automatic logging
setup_error_trap() {
  set -E
  trap 'handle_error ${LINENO} ${BASH_LINENO} "${BASH_COMMAND}" "${BASH_SOURCE}"' ERR
}

# Handle errors with detailed logging
handle_error() {
  local line_number="$1"
  local bash_lineno="$2"
  local command="$3"
  local source_file="$4"
  
  log_error "Error occurred in script: ${source_file}"
  log_error "Line number: ${line_number}"
  log_error "Command: ${command}"
  log_error "Bash lineno: ${bash_lineno}"
  
  # Log stack trace
  log_error "Stack trace:"
  local frame=0
  while caller $frame; do
    ((frame++))
  done | while read line func file; do
    log_error "  at ${func} (${file}:${line})"
  done
}

# ============================================================================
# Export Functions
# ============================================================================

# Make functions available to other scripts
export -f log_info
export -f log_success
export -f log_warning
export -f log_error
export -f log_debug
export -f log_section
export -f log_step
export -f run_command
export -f run_silent
export -f run_with_spinner
export -f get_timestamp
export -f get_timestamp_filename
export -f calculate_duration
export -f init_log_file
export -f append_to_log
export -f save_command_output
export -f setup_error_trap
export -f handle_error

