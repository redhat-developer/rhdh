#!/usr/bin/env bash
#
# Bootstrap Module - Load all core modules in correct order
# This module simplifies job scripts by centralizing common module imports
#

# Guard to prevent multiple sourcing
if [[ -n "${_BOOTSTRAP_LOADED:-}" ]]; then
    return 0
fi
readonly _BOOTSTRAP_LOADED=true

# Determine module directory
MODULES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load core modules in dependency order
source "${MODULES_DIR}/constants.sh"
source "${MODULES_DIR}/retry.sh"
source "${MODULES_DIR}/logging.sh"
source "${MODULES_DIR}/platform/detection.sh"
source "${MODULES_DIR}/k8s-operations.sh"
source "${MODULES_DIR}/helm.sh"
source "${MODULES_DIR}/common.sh"
source "${MODULES_DIR}/reporting.sh"
source "${MODULES_DIR}/env/exporters.sh"

# Export default provider envs (OCM/Keycloak/GitHub) for ConfigMaps/values usage
export_default_providers_env

log_debug "Bootstrap: Core modules loaded successfully"


