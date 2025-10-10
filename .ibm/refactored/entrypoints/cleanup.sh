#!/usr/bin/env bash
#
# Direct entry point for cleanup
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

# Source modules needed for cleanup
# shellcheck source=../modules/logging.sh
source "${DIR}/modules/logging.sh"
# shellcheck source=../modules/k8s-operations.sh
source "${DIR}/modules/k8s-operations.sh"

# Main cleanup logic
main() {
    log_header "RHDH Cleanup"

    local namespaces=(
        "${NAME_SPACE:-showcase}"
        "${NAME_SPACE_RBAC:-showcase-rbac}"
        "${NAME_SPACE_K8S:-showcase-k8s-ci-nightly}"
        "${NAME_SPACE_K8S_RBAC:-showcase-rbac-k8s-ci-nightly}"
    )

    for ns in "${namespaces[@]}"; do
        if kubectl get namespace "$ns" &>/dev/null; then
            log_info "Cleaning up namespace: $ns"
            delete_namespace "$ns"
        fi
    done

    log_success "Cleanup completed"
}

# Execute
main "$@"