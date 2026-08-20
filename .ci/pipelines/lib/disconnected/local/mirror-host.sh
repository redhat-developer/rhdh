#!/usr/bin/env bash
# LOCAL_DISCONNECTED IDMS/ITMS mirror-host rewriting: push-route host ->
# in-cluster registry service so kubelet/catalogd can authenticate. Sourced
# only when LOCAL_DISCONNECTED=1.

[[ -n "${_DISCONNECTED_LOCAL_MIRROR_HOST_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_MIRROR_HOST_SOURCED=1

# Rewrite applied IDMS/ITMS resources: push-route host -> in-cluster registry
# service. prepare/oc-mirror emit the external default-route; kubelet/catalogd
# need the svc.
disconnected::rewrite_live_mirror_hosts_for_cluster() {
  if [[ -z "${MIRROR_REGISTRY_URL:-}" || -z "${MIRROR_REGISTRY_CLUSTER_URL:-}" ]]; then
    return 0
  fi
  if [[ "${MIRROR_REGISTRY_URL}" == "${MIRROR_REGISTRY_CLUSTER_URL}" ]]; then
    return 0
  fi

  local kind name tmp
  for kind in imagedigestmirrorset imagetagmirrorset; do
    while IFS= read -r name; do
      [[ -n "${name}" ]] || continue
      tmp=$(mktemp)
      if ! oc get "${kind}" "${name}" -o yaml > "${tmp}" 2> /dev/null; then
        rm -f "${tmp}"
        continue
      fi
      if ! grep -qF "${MIRROR_REGISTRY_URL}" "${tmp}"; then
        rm -f "${tmp}"
        continue
      fi
      sed "s|${MIRROR_REGISTRY_URL}|${MIRROR_REGISTRY_CLUSTER_URL}|g" "${tmp}" \
        | oc apply -f - > /dev/null || {
        log::error "Failed to rewrite ${kind}/${name} mirror host for cluster pulls"
        rm -f "${tmp}"
        return 1
      }
      rm -f "${tmp}"
      log::info "Rewrote live ${kind}/${name}: ${MIRROR_REGISTRY_URL} -> ${MIRROR_REGISTRY_CLUSTER_URL}"
    done < <(oc get "${kind}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2> /dev/null || true)
  done
}

# Rewrite oc-mirror IDMS/ITMS mirror host from the push route to the in-cluster
# registry service so kubelet can authenticate.
# Args:
#   $1 - yaml file path (IDMS or ITMS)
disconnected::rewrite_mirror_host_for_cluster() {
  local file=$1
  if [[ -z "${MIRROR_REGISTRY_URL:-}" || -z "${MIRROR_REGISTRY_CLUSTER_URL:-}" ]]; then
    return 0
  fi
  if [[ ! -s "${file}" ]]; then
    return 0
  fi
  if grep -qF "${MIRROR_REGISTRY_URL}" "${file}"; then
    local tmp
    tmp=$(mktemp)
    sed "s|${MIRROR_REGISTRY_URL}|${MIRROR_REGISTRY_CLUSTER_URL}|g" "${file}" > "${tmp}"
    mv "${tmp}" "${file}"
    log::info "Rewrote mirror host in $(basename "${file}"): ${MIRROR_REGISTRY_URL} -> ${MIRROR_REGISTRY_CLUSTER_URL}"
  fi
}
