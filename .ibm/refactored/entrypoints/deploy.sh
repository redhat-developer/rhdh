#!/usr/bin/env bash
#
# Direct entry point for deploy job
# No JOB_NAME dependency - this IS the deploy job
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

# Import the actual job
# shellcheck source=../jobs/deploy-base.sh
source "${DIR}/jobs/deploy-base.sh"

# Execute with all arguments passed through
main "$@"