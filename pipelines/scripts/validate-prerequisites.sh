#!/bin/bash
# Validate prerequisites for RHDH CI/CD Pipeline

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINES_ROOT="$(dirname "${SCRIPT_DIR}")"

# Source logging utilities for consistent color output
# shellcheck source=../core/logging.sh
source "${PIPELINES_ROOT}/core/logging.sh"

# ============================================================================
# Functions
# ============================================================================

check_command() {
  local cmd=$1
  local required=${2:-true}
  local min_version=${3:-""}
  
  if command -v "${cmd}" &> /dev/null; then
    local version_output=$(${cmd} --version 2>&1 | head -n1 || echo "unknown")
    echo -e "${COLOR_GREEN}✅ ${cmd} found:${COLOR_RESET} ${version_output}"
    
    # Check minimum version if specified
    if [[ -n "${min_version}" ]]; then
      # This is a simple check, could be improved with proper version comparison
      echo "   ${COLOR_CYAN}Note: Minimum version ${min_version} expected${COLOR_RESET}"
    fi
    
    return 0
  elif [[ "${required}" == "true" ]]; then
    echo -e "${COLOR_RED}❌ ${cmd} not found (required)${COLOR_RESET}"
    return 1
  else
    echo -e "${COLOR_YELLOW}⚠️  ${cmd} not found (optional)${COLOR_RESET}"
    return 0
  fi
}

check_bash_version() {
  local min_version=4
  local current_version="${BASH_VERSINFO[0]}"
  
  echo -e "${COLOR_CYAN}Checking Bash version...${COLOR_RESET}"
  
  if [[ ${current_version} -ge ${min_version} ]]; then
    echo -e "${COLOR_GREEN}✅ Bash ${BASH_VERSION} found (>= ${min_version}.x required)${COLOR_RESET}"
    return 0
  else
    echo -e "${COLOR_YELLOW}⚠️  Bash ${BASH_VERSION} found, but version ${min_version}.x or higher recommended${COLOR_RESET}"
    
    # macOS ships with Bash 3.2, provide installation instructions
    if [[ "$(uname)" == "Darwin" ]]; then
      echo -e "${COLOR_CYAN}   macOS Note: Install Bash 5 with: brew install bash${COLOR_RESET}"
      echo -e "${COLOR_CYAN}   After installation, you may need to update your PATH or use /usr/local/bin/bash${COLOR_RESET}"
    fi
    
    # Don't fail, just warn - scripts should mostly work with Bash 3.2
    echo -e "${COLOR_YELLOW}   Most scripts should still work, but some features may be limited${COLOR_RESET}"
    return 0
  fi
}

check_gnu_tools_macos() {
  if [[ "$(uname)" != "Darwin" ]]; then
    return 0
  fi
  
  echo ""
  echo -e "${COLOR_CYAN}Checking GNU tools on macOS...${COLOR_RESET}"
  
  local has_gnu_grep=false
  local has_gnu_sed=false
  
  # Check for GNU grep
  if command -v ggrep &> /dev/null; then
    echo -e "${COLOR_GREEN}✅ GNU grep found (ggrep)${COLOR_RESET}"
    has_gnu_grep=true
  elif grep --version 2>&1 | grep -q "GNU grep"; then
    echo -e "${COLOR_GREEN}✅ GNU grep found (grep)${COLOR_RESET}"
    has_gnu_grep=true
  else
    echo -e "${COLOR_YELLOW}⚠️  GNU grep not found. Install with: brew install grep${COLOR_RESET}"
  fi
  
  # Check for GNU sed
  if command -v gsed &> /dev/null; then
    echo -e "${COLOR_GREEN}✅ GNU sed found (gsed)${COLOR_RESET}"
    has_gnu_sed=true
  elif sed --version 2>&1 | grep -q "GNU sed"; then
    echo -e "${COLOR_GREEN}✅ GNU sed found (sed)${COLOR_RESET}"
    has_gnu_sed=true
  else
    echo -e "${COLOR_YELLOW}⚠️  GNU sed not found. Install with: brew install gnu-sed${COLOR_RESET}"
  fi
  
  if ! $has_gnu_grep || ! $has_gnu_sed; then
    echo -e "${COLOR_YELLOW}   Note: GNU tools are recommended for macOS to ensure compatibility${COLOR_RESET}"
  fi
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
  echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
  echo -e "${COLOR_CYAN} RHDH CI/CD Pipeline - Prerequisites Check${COLOR_RESET}"
  echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
  echo ""
  
  local errors=0
  local warnings=0
  
  # Check Bash version
  check_bash_version || ((errors++))
  
  echo ""
  echo -e "${COLOR_CYAN}Checking required tools...${COLOR_RESET}"
  
  # Required tools
  check_command "oc" true || ((errors++))
  check_command "helm" true "3.0" || ((errors++))
  check_command "kubectl" true || ((errors++))
  check_command "yq" true "4.0" || ((errors++))
  check_command "jq" true "1.6" || ((errors++))
  check_command "git" true || ((errors++))
  check_command "base64" true || ((errors++))
  check_command "curl" true || ((errors++))
  
  echo ""
  echo -e "${COLOR_CYAN}Checking optional tools...${COLOR_RESET}"
  
  # Optional tools (for local development)
  check_command "yarn" false "3.x" || ((warnings++))
  check_command "node" false "22.x" || ((warnings++))
  check_command "shellcheck" false || ((warnings++))
  check_command "tree" false || ((warnings++))
  check_command "make" false || ((warnings++))
  check_command "ansi2html" false || ((warnings++))
  
  # Check GNU tools on macOS
  check_gnu_tools_macos
  
  # Summary
  echo ""
  echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
  echo -e "${COLOR_CYAN} Summary${COLOR_RESET}"
  echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
  
  if [[ ${errors} -eq 0 ]]; then
    echo -e "${COLOR_GREEN}✅ All required prerequisites are met!${COLOR_RESET}"
    
    if [[ ${warnings} -gt 0 ]]; then
      echo -e "${COLOR_YELLOW}⚠️  ${warnings} optional tool(s) missing (recommended for local development)${COLOR_RESET}"
    fi
    
    echo ""
    echo -e "${COLOR_GREEN}You can run the pipeline with:${COLOR_RESET}"
    echo "  ./pipelines/main.sh"
    echo "  or"
    echo "  make ocp-pull"
    
    exit 0
  else
    echo -e "${COLOR_RED}❌ ${errors} required tool(s) missing!${COLOR_RESET}"
    echo ""
    echo -e "${COLOR_YELLOW}Please install missing tools before running the pipeline.${COLOR_RESET}"
    echo ""
    echo "Installation instructions:"
    echo "  - macOS:   brew install <tool>"
    echo "  - RHEL/Fedora: dnf install <tool>"
    echo "  - Ubuntu/Debian: apt install <tool>"
    
    exit 1
  fi
}

# Run main function
main "$@"

