#!/usr/bin/env bash
#
# Logging Module - Centralized logging functions
#

# Guard to prevent multiple sourcing
if [[ -n "${_LOGGING_LOADED:-}" ]]; then
    return 0
fi
readonly _LOGGING_LOADED=true

# Color codes for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')] [INFO]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] [ERROR]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')] [SUCCESS]${NC} $*" >&2
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] [WARNING]${NC} $*" >&2
}

log_debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo "[$(date '+%H:%M:%S')] [DEBUG] $*" >&2
    fi
}

log_header() {
    echo -e "${BLUE}===========================================${NC}" >&2
    echo -e "${BLUE}  $*${NC}" >&2
    echo -e "${BLUE}===========================================${NC}" >&2
}

log_section() {
    echo -e "${BLUE}>>> $* ${NC}" >&2
}

# Export functions
export -f log_info log_error log_success log_warning log_debug log_header log_section