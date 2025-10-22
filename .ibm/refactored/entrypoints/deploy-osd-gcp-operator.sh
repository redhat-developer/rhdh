#!/usr/bin/env bash
#
# Deploy RHDH to OpenShift Dedicated on GCP using Operator
# Reuses OCP operator job as per legacy pipeline pattern
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

# OSD-GCP specific configuration
export CLUSTER_TYPE="osd-gcp"
export PLATFORM="gcp"

# Import the OCP operator job (reuses OCP logic for OSD-GCP)
# shellcheck source=../jobs/ocp-operator.sh
source "${DIR}/jobs/ocp-operator.sh"

# Execute the handler
handle_ocp_operator "$@"


