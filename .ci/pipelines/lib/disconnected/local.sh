#!/usr/bin/env bash

# Local-cluster overrides for disconnected CI. Sourced only when LOCAL_DISCONNECTED=1.
#
# This is a thin facade: the implementation is split by concern under local/.
#   hooks.sh        cluster_mirror_host + _hook_* overrides for mirror.sh/plugins.sh
#   registry.sh     integrated-registry bring-up, retry-on-503, MIRROR_* bootstrap
#   access.sh       mirror push-target projects, workload + OLM pull access
#   mirror-host.sh  IDMS/ITMS push-route -> in-cluster registry service rewrite
#   plugins.sh      homepage-only mirror_plugins override + imagestream tags

[[ -n "${_DISCONNECTED_LOCAL_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_SOURCED=1

_disconnected_local_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/local"

# shellcheck source=.ci/pipelines/lib/disconnected/local/hooks.sh
source "${_disconnected_local_dir}/hooks.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/local/registry.sh
source "${_disconnected_local_dir}/registry.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/local/access.sh
source "${_disconnected_local_dir}/access.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/local/mirror-host.sh
source "${_disconnected_local_dir}/mirror-host.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/local/plugins.sh
source "${_disconnected_local_dir}/plugins.sh"

unset _disconnected_local_dir
