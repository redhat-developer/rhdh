#!/usr/bin/env bash
# LOCAL_DISCONNECTED hook overrides for the shared CI modules (mirror.sh,
# plugins.sh) plus the in-cluster registry host resolver. Sourced only when
# LOCAL_DISCONNECTED=1 (via lib/disconnected/local.sh).

[[ -n "${_DISCONNECTED_LOCAL_HOOKS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_HOOKS_SOURCED=1

# In-cluster integrated registry service for kubelet-authenticated pulls,
# falling back to the external route when the cluster URL is unset.
disconnected::cluster_mirror_host() {
  if [[ -n "${MIRROR_REGISTRY_CLUSTER_URL:-}" ]]; then
    printf '%s' "${MIRROR_REGISTRY_CLUSTER_URL}"
  else
    printf '%s' "${MIRROR_REGISTRY_URL}"
  fi
}

# Skip hub image on integrated registry: the chart hub digest suffices and
# the integrated registry cannot store docker manifest lists while
# oc-mirror preserve-digests is active.
disconnected::_hook_should_add_hub_image() { return 1; }

# OpenShift integrated registry rejects cosign/sigstore .sig attachments.
disconnected::_hook_adjust_oc_mirror_args() {
  local -n _args=$1
  _args+=(--remove-signatures)
}

# Recreate + RWO PVC leaves the integrated registry route at HTTP 503.
disconnected::_hook_run_oc_mirror() {
  disconnected::retry_on_local_registry 5 "$@"
}

# Rewrite push-route host to in-cluster registry service so kubelet can authenticate.
disconnected::_hook_rewrite_mirror_host() {
  disconnected::rewrite_mirror_host_for_cluster "$1"
}

# Re-push digest-mirrored plugins under explicit :sha256-<digest> tags so
# the integrated registry serves them through ImageStreams.
disconnected::_hook_post_mirror_plugins() {
  disconnected::ensure_local_plugin_imagestream_tags "$1"
}

# Integrated registry ImageStreams are pullable by :sha256-<digest> tags.
# Pulling the source multi-arch list digest returns manifest unknown.
disconnected::_hook_catalog_index_exports() {
  local name=$1 digest=$2
  export CATALOG_INDEX_REPO="rhdh/${name}"
  export CATALOG_INDEX_TAG="sha256-${digest#sha256:}"
  export CATALOG_INDEX_IMAGE="${CATALOG_INDEX_REGISTRY}/${CATALOG_INDEX_REPO}:${CATALOG_INDEX_TAG}"
}
