#!/usr/bin/env bash
#
# Direct entry point for nightly tests
#
set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source environment
if [[ -f "${DIR}/env_variables.sh" ]]; then
    # shellcheck source=../env_variables.sh
    source "${DIR}/env_variables.sh"
fi

# Source local overrides if present
if [[ -f "${DIR}/env_override.local.sh" ]]; then
    # shellcheck source=/dev/null
    source "${DIR}/env_override.local.sh"
fi

# Nightly always uses orchestrator
export DEPLOY_ORCHESTRATOR=true

# Import the actual job
# shellcheck source=../jobs/ocp-nightly.sh
source "${DIR}/jobs/ocp-nightly.sh"

# Execute with all arguments passed through
main "$@"