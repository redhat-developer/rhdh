#!/usr/bin/env bash
#
# Direct entry point for testing deployed RHDH
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

# Source required modules
# shellcheck source=../modules/logging.sh
source "${DIR}/modules/logging.sh"
# shellcheck source=../modules/testing/backstage.sh
source "${DIR}/modules/testing/backstage.sh"

# Main test logic
main() {
    log_header "RHDH Test Suite"

    local namespace="${NAME_SPACE:-showcase}"
    local namespace_rbac="${NAME_SPACE_RBAC:-showcase-rbac}"

    # Test standard deployment if exists
    if kubectl get namespace "$namespace" &>/dev/null; then
        log_section "Testing standard deployment"
        test_backstage_health "$namespace"
        run_backstage_basic_tests "$namespace"
    fi

    # Test RBAC deployment if exists
    if kubectl get namespace "$namespace_rbac" &>/dev/null; then
        log_section "Testing RBAC deployment"
        test_backstage_health "$namespace_rbac"
        run_backstage_basic_tests "$namespace_rbac"
    fi

    log_success "All tests completed"
}

# Execute
main "$@"