#!/usr/bin/env bash

# Disconnected CI pipeline library — facade.
# Sources modular components and provides the public API.
#
# Dependencies: lib/log.sh, lib/common.sh
# Consumers: jobs/ocp-disconnected-helm.sh, jobs/ocp-disconnected-operator.sh

# Prevent re-sourcing
if [[ -n "${DISCONNECTED_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly DISCONNECTED_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ci/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"

# Shared temp directory for disconnected CI artifacts.
DISCONNECTED_TMPDIR=$(mktemp -d)
export DISCONNECTED_TMPDIR

# --- CI modules ---
# shellcheck source=.ci/pipelines/lib/disconnected/env.sh
source "${DIR}/lib/disconnected/env.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/scripts.sh
source "${DIR}/lib/disconnected/scripts.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/mirror.sh
source "${DIR}/lib/disconnected/mirror.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/plugins.sh
source "${DIR}/lib/disconnected/plugins.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/namespace.sh
source "${DIR}/lib/disconnected/namespace.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/operator.sh
source "${DIR}/lib/disconnected/operator.sh"
# shellcheck source=.ci/pipelines/lib/disconnected/helm.sh
source "${DIR}/lib/disconnected/helm.sh"

# --- Local-cluster overrides (sourced only when LOCAL_DISCONNECTED=1) ---
if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
  # shellcheck source=.ci/pipelines/lib/disconnected/local.sh
  source "${DIR}/lib/disconnected/local.sh"
fi

# --- Export all public functions for subshell usage (e.g., timeout bash -c) ---
# env.sh
export -f disconnected::require_env
export -f disconnected::setup_auth
export -f disconnected::with_unset_registry_auth_file
export -f disconnected::fetch_operator_repo_script
# mirror.sh
export -f disconnected::wait_mirror_registry_route
export -f disconnected::cluster_mirror_host
export -f disconnected::build_imageset_config
export -f disconnected::run_oc_mirror
export -f disconnected::patch_idms
export -f disconnected::wait_mcp_updated
export -f disconnected::_hook_should_add_hub_image
export -f disconnected::_hook_adjust_oc_mirror_args
export -f disconnected::_hook_run_oc_mirror
export -f disconnected::_hook_rewrite_mirror_host
# plugins.sh
export -f disconnected::mirror_plugins
export -f disconnected::resolve_catalog_index_image
export -f disconnected::resolve_homepage_plugin_package
export -f disconnected::_homepage_plugin_from_oci_dir
export -f disconnected::write_homepage_dynamic_plugins_yaml
export -f disconnected::create_homepage_plugins_configmap
export -f disconnected::write_homepage_helm_values
export -f disconnected::apply_plugin_mirror_configmap
export -f disconnected::_hook_post_mirror_plugins
export -f disconnected::_hook_catalog_index_exports
export -f disconnected::_hook_homepage_package_ref
# namespace.sh
export -f disconnected::create_mirror_registry_ca_configmap
export -f disconnected::create_plugin_registry_auth_secret
export -f disconnected::ensure_mirror_registry_ca
export -f disconnected::ensure_olm_mirror_pull_secret
# operator.sh
export -f disconnected::dump_olm_v1_status
export -f disconnected::wait_operator_crd_olm_v1
# helm.sh
export -f disconnected::ensure_helm_hub_after_postgres
# mirror.sh / plugins.sh CI-safe defaults (always defined; local.sh overrides)
export -f disconnected::retry_on_local_registry
# local.sh (exported only when sourced, but export -f of undefined is harmless)
export -f disconnected::wait_local_integrated_registry 2> /dev/null || true
export -f disconnected::setup_local_ocp_mirror 2> /dev/null || true
export -f disconnected::ensure_local_image_pull_access 2> /dev/null || true
export -f disconnected::ensure_local_ocp_internal_olm_access 2> /dev/null || true
export -f disconnected::rewrite_live_mirror_hosts_for_cluster 2> /dev/null || true
export -f disconnected::rewrite_mirror_host_for_cluster 2> /dev/null || true
export -f disconnected::ensure_local_amd64_skopeo_shim 2> /dev/null || true
export -f disconnected::write_digest_plugin_list 2> /dev/null || true
export -f disconnected::ensure_local_plugin_imagestream_tags 2> /dev/null || true
