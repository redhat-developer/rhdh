#!/usr/bin/env bash
# LOCAL_DISCONNECTED cluster access: mirror push-target projects, workload
# image-pull access, and OLM internal-registry access. Sourced only when
# LOCAL_DISCONNECTED=1.

[[ -n "${_DISCONNECTED_LOCAL_ACCESS_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_ACCESS_SOURCED=1

# Projects that oc-mirror/skopeo push mirrored images into. Kept in sync with
# the pull-access grants in disconnected::ensure_local_image_pull_access.
DISCONNECTED_LOCAL_MIRROR_PROJECTS=(oc-mirror rhdh-community rhel9 rhdh rhdh-plugin-export-overlays)

# Ensure a single integrated-registry push-target namespace exists. Idempotent
# and race-tolerant: an existing namespace (or one that appears between the
# check and create) is treated as success.
# Args:
#   $1 - namespace
disconnected::ensure_local_mirror_namespace() {
  local ns=$1
  if oc get namespace "${ns}" > /dev/null 2>&1; then
    return 0
  fi
  if oc create namespace "${ns}" > /dev/null 2>&1; then
    log::info "Created mirror push-target project ${ns}"
    return 0
  fi
  # Tolerate a race where the namespace appears between check and create.
  if oc get namespace "${ns}" > /dev/null 2>&1; then
    return 0
  fi
  log::error "Failed to create mirror push-target project ${ns}"
  return 1
}

# Pre-create the known integrated-registry push-target projects. Idempotent:
# existing projects are left untouched. Without this, the first push to a fresh
# cluster fails at the manifest write with "denied". Note that plugin pushes may
# target additional, data-driven namespaces (derived from plugin source paths);
# those are created lazily in disconnected::ensure_local_plugin_imagestream_tags.
disconnected::ensure_local_mirror_projects() {
  local proj
  for proj in "${DISCONNECTED_LOCAL_MIRROR_PROJECTS[@]}"; do
    disconnected::ensure_local_mirror_namespace "${proj}" || return 1
  done
  log::success "Local mirror push-target projects ready: ${DISCONNECTED_LOCAL_MIRROR_PROJECTS[*]}"
}

# Allow the workload namespace to pull mirrored images from the integrated
# registry projects created by oc-mirror/skopeo (cross-namespace). Also attach
# a dockerconfig pull secret so kubelet can authenticate.
# Args:
#   $1 - namespace
disconnected::ensure_local_image_pull_access() {
  local namespace=$1

  common::require_vars MIRROR_REGISTRY_PULL_SECRET || return 1

  local secret_name="mirror-registry-pull"
  local b64
  b64=$(base64 -w0 < "${MIRROR_REGISTRY_PULL_SECRET}" 2> /dev/null \
    || base64 < "${MIRROR_REGISTRY_PULL_SECRET}" | tr -d '\n')

  namespace::setup_image_pull_secret "${namespace}" "${secret_name}" "${b64}" || {
    log::error "Failed to create/link ${secret_name} in ${namespace}"
    return 1
  }

  # oc-mirror push path is <registry>/<project>/... -- grant pull across those projects.
  local proj
  for proj in "${DISCONNECTED_LOCAL_MIRROR_PROJECTS[@]}"; do
    if oc get project "${proj}" > /dev/null 2>&1 || oc get namespace "${proj}" > /dev/null 2>&1; then
      if oc adm policy add-role-to-group system:image-puller \
        "system:serviceaccounts:${namespace}" -n "${proj}" > /dev/null; then
        log::info "Granted system:image-puller on ${proj} to system:serviceaccounts:${namespace}"
      else
        log::warn "Failed to grant image-puller on ${proj} -- continuing"
      fi
    fi
  done

  log::success "Local image pull access configured for ${namespace}"
}

# After prepare --to-registry OCP_INTERNAL, catalogd/operator-controller must
# pull mirrored catalog/bundle images from the oc-mirror project. prepare grants
# image-puller on namespace "rhdh", not "oc-mirror", so ClusterCatalog stays
# Progressing with "authentication required". Also rewrite live IDMS/ITMS from
# the external registry route to the in-cluster service (kubelet/catalogd auth).
disconnected::ensure_local_ocp_internal_olm_access() {
  common::require_vars MIRROR_REGISTRY_URL MIRROR_REGISTRY_CLUSTER_URL || return 1

  log::section "Local disconnected: OLM access to OCP internal mirror"

  # prepare may roll the registry; wait it out so catalogd does not flap.
  log::info "Waiting for image-registry ClusterOperator Available=True..."
  if ! oc wait co/image-registry --for=condition=Available=True --timeout=10m; then
    log::error "image-registry ClusterOperator did not become Available after prepare"
    return 1
  fi

  local mirror_ns="oc-mirror"
  if oc get namespace "${mirror_ns}" > /dev/null 2>&1 || oc get project "${mirror_ns}" > /dev/null 2>&1; then
    local sa_ns
    for sa_ns in openshift-catalogd openshift-operator-controller; do
      if oc adm policy add-role-to-group system:image-puller \
        "system:serviceaccounts:${sa_ns}" -n "${mirror_ns}" > /dev/null; then
        log::info "Granted system:image-puller on ${mirror_ns} to system:serviceaccounts:${sa_ns}"
      else
        log::warn "Failed to grant image-puller on ${mirror_ns} to ${sa_ns} -- continuing"
      fi
      local sa
      case "${sa_ns}" in
        openshift-catalogd) sa="catalogd-controller-manager" ;;
        openshift-operator-controller) sa="operator-controller-controller-manager" ;;
        *) sa="" ;;
      esac
      if [[ -n "${sa}" ]]; then
        oc adm policy add-role-to-user system:image-puller \
          "system:serviceaccount:${sa_ns}:${sa}" -n "${mirror_ns}" > /dev/null 2>&1 || true
      fi
    done
  else
    log::warn "Namespace ${mirror_ns} not found -- skipping OLM image-puller grants"
  fi

  disconnected::rewrite_live_mirror_hosts_for_cluster || return 1
  log::success "LOCAL_DISCONNECTED OLM internal-registry access configured"
}
