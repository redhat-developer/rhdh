#!/usr/bin/env bash

# Local-cluster overrides for disconnected CI. Sourced only when LOCAL_DISCONNECTED=1.

[[ -n "${_DISCONNECTED_LOCAL_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_SOURCED=1

# ---------------------------------------------------------------------------
# Hook overrides for CI modules:
#   mirror.sh:  _hook_should_add_hub_image, _hook_adjust_oc_mirror_args,
#               _hook_run_oc_mirror, _hook_rewrite_mirror_host, cluster_mirror_host
#   plugins.sh: mirror_plugins (full override), _hook_post_mirror_plugins,
#               _hook_catalog_index_exports, _hook_homepage_package_ref
# ---------------------------------------------------------------------------

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

# ImageStream :sha256-<digest> tag format for homepage plugin pulls.
disconnected::_hook_homepage_package_ref() {
  local name=$1 digest=$2
  echo "oci://registry.access.redhat.com/rhdh/${name}:sha256-${digest#sha256:}!${name}"
}

# Full override: digest-only plugin list, retry loop, skopeo catalog copy,
# summary handling, and imagestream tagging.
disconnected::mirror_plugins() {
  local mirror_script="${DISCONNECTED_TMPDIR}/mirror-plugins.sh"

  disconnected::fetch_script "mirror-plugins.sh" "${mirror_script}" || {
    log::error "Failed to fetch mirror-plugins.sh -- aborting"
    return 1
  }

  local plugin_index
  plugin_index="oci://$(disconnected::_catalog_index_source_ref)"

  local list_file="${DISCONNECTED_TMPDIR}/local-digest-plugins.txt"
  disconnected::write_digest_plugin_list "${plugin_index}" "${list_file}" || return 1

  # --plugin-list only (not --plugin-index): index mode re-adds fragile tags.
  # Catalog index is mirrored after plugins so the summary still records it.
  local attempt
  local max_attempts=5
  local mirrored=0
  for attempt in $(seq 1 "${max_attempts}"); do
    disconnected::wait_local_integrated_registry || return 1
    if bash "${mirror_script}" \
      --plugin-list "${list_file}" \
      --to-registry "${MIRROR_REGISTRY_URL}"; then
      mirrored=1
      break
    fi
    log::warn "mirror-plugins.sh attempt ${attempt}/${max_attempts} failed (registry 503 during Recreate is typical)"
  done
  if [[ "${mirrored}" != "1" ]]; then
    log::error "mirror-plugins.sh (digest-only list) failed after ${max_attempts} attempts -- aborting"
    return 1
  fi

  local index_ref="${plugin_index#oci://}"
  local catalog_dest="${MIRROR_REGISTRY_URL}/rhdh/plugin-catalog-index"
  if [[ "${index_ref}" =~ @sha256:[0-9a-f]+$ ]]; then
    catalog_dest="${catalog_dest}@${index_ref##*@}"
  elif [[ "${index_ref}" =~ :([^:/]+)$ ]]; then
    catalog_dest="${catalog_dest}:${BASH_REMATCH[1]}"
  else
    catalog_dest="${catalog_dest}:latest"
  fi
  # Use real skopeo --all (not the amd64 shim): destination @sha256 must stay the
  # multi-arch list digest; single-arch flatten yields "digest invalid".
  local real_skopeo=""
  local candidate
  for candidate in /usr/bin/skopeo /usr/local/bin/skopeo; do
    if [[ -x "${candidate}" ]]; then
      real_skopeo="${candidate}"
      break
    fi
  done
  if [[ -z "${real_skopeo}" ]]; then
    real_skopeo=$(type -P skopeo)
    while [[ "${real_skopeo}" == *disconnected-skopeo-shim* ]]; do
      real_skopeo=$(PATH="${PATH#"${real_skopeo%/*}":}" type -P skopeo) || break
    done
  fi
  log::info "Mirroring catalog index -> ${catalog_dest} (skopeo --all)"
  local index_copied=0
  for attempt in $(seq 1 "${max_attempts}"); do
    disconnected::wait_local_integrated_registry || return 1
    if "${real_skopeo}" copy --all --remove-signatures --dest-tls-verify=false \
      "docker://${index_ref}" "docker://${catalog_dest}"; then
      index_copied=1
      break
    fi
    log::warn "catalog index copy attempt ${attempt}/${max_attempts} failed"
  done
  if [[ "${index_copied}" != "1" ]]; then
    log::error "Failed to mirror catalog index ${index_ref}"
    return 1
  fi
  # Ensure summary includes catalog index for resolve_catalog_index_image.
  local summary_src
  summary_src="$(pwd)/rhdh-plugin-mirroring-summary.txt"
  if [[ -f "${summary_src}" ]] && ! grep -qF 'plugin-catalog-index' "${summary_src}"; then
    echo "${plugin_index} -> oci://${catalog_dest}" >> "${summary_src}"
  fi

  # Copy summary to standard locations.
  if [[ ! -f "${summary_src}" ]]; then
    log::error "mirror-plugins.sh succeeded but summary not found at ${summary_src}"
    return 1
  fi
  cp "${summary_src}" "${DISCONNECTED_TMPDIR}/rhdh-plugin-mirroring-summary.txt" || {
    log::error "Failed to copy plugin mirroring summary to ${DISCONNECTED_TMPDIR}"
    return 1
  }
  cp "${summary_src}" "${ARTIFACT_DIR}/rhdh-plugin-mirroring-summary.txt" || {
    log::error "Failed to copy plugin mirroring summary to ${ARTIFACT_DIR}"
    return 1
  }
  log::info "Saved plugin mirroring summary to ${DISCONNECTED_TMPDIR} and ${ARTIFACT_DIR}"

  disconnected::ensure_local_plugin_imagestream_tags "${summary_src}" || return 1
}

# ---------------------------------------------------------------------------
# Local-only functions
# ---------------------------------------------------------------------------

# Recreate + RWO PVC (ceph-rbd) leaves the registry route at HTTP 503 for
# several minutes while the old pod releases the volume.
disconnected::wait_local_integrated_registry() {
  log::info "Waiting for image-registry ClusterOperator Available=True..."
  if ! oc wait co/image-registry --for=condition=Available=True --timeout=15m; then
    log::error "image-registry ClusterOperator did not become Available"
    return 1
  fi
  log::info "Waiting for deploy/image-registry Available (Recreate + RWO PVC)..."
  if ! oc wait -n openshift-image-registry deploy/image-registry \
    --for=condition=Available --timeout=15m; then
    log::error "deploy/image-registry did not become Available"
    return 1
  fi
  disconnected::wait_mirror_registry_route 900
}

# Retry a command after waiting for the integrated registry. Merging the
# cluster pull-secret (prepare) and Recreate+RWO leave the route at HTTP 503.
disconnected::retry_on_local_registry() {
  local max_attempts="${1:-5}"
  shift
  local attempt
  for attempt in $(seq 1 "${max_attempts}"); do
    disconnected::wait_local_integrated_registry || return 1
    if "$@"; then
      return 0
    fi
    log::warn "attempt ${attempt}/${max_attempts} failed; waiting for integrated registry Recreate then retrying"
  done
  return 1
}

# Bootstrap MIRROR_* for local disconnected runs on a connected OpenShift cluster.
# Exposes the cluster image registry route and writes auth/CA under
# ${SHARED_DIR}/disconnected-mirror/ (inside the e2e-runner worktree mount).
# Call after oc login when LOCAL_DISCONNECTED=1, before require_env/setup_auth.
disconnected::setup_local_ocp_mirror() {
  if [[ -z "${SHARED_DIR:-}" ]]; then
    log::error "SHARED_DIR is unset; cannot write local disconnected mirror credentials"
    return 1
  fi

  local mirror_dir="${SHARED_DIR}/disconnected-mirror"
  mkdir -p "${mirror_dir}"

  log::section "Local disconnected: expose OCP image registry"
  oc patch configs.imageregistry.operator.openshift.io/cluster --type=merge \
    -p '{"spec":{"defaultRoute":true,"disableRedirect":true}}' || {
    log::error "Failed to patch image registry config for defaultRoute/disableRedirect"
    return 1
  }

  for _ in $(seq 1 60); do
    if oc get route default-route -n openshift-image-registry > /dev/null 2>&1; then
      break
    fi
    sleep 5
  done
  if ! oc get route default-route -n openshift-image-registry > /dev/null 2>&1; then
    log::error "default-route not available in openshift-image-registry after wait"
    return 1
  fi

  export MIRROR_REGISTRY_URL
  MIRROR_REGISTRY_URL=$(oc get route default-route -n openshift-image-registry -o jsonpath='{.spec.host}')
  if [[ -z "${MIRROR_REGISTRY_URL}" ]]; then
    log::error "Failed to resolve default-route host"
    return 1
  fi
  log::info "MIRROR_REGISTRY_URL=${MIRROR_REGISTRY_URL} (push via ingress route)"

  # Kubelet authenticates to the integrated registry via the in-cluster service,
  # not the external route (route pulls fail with "authentication required").
  export MIRROR_REGISTRY_CLUSTER_URL="image-registry.openshift-image-registry.svc:5000"
  log::info "MIRROR_REGISTRY_CLUSTER_URL=${MIRROR_REGISTRY_CLUSTER_URL} (cluster pulls / IDMS)"

  # Patching defaultRoute/disableRedirect restarts the registry Deployment.
  disconnected::wait_local_integrated_registry || return 1

  local ca_path="${mirror_dir}/ca.crt"
  if ! oc get configmap default-ingress-cert -n openshift-config-managed \
    -o jsonpath='{.data.ca-bundle\.crt}' > "${ca_path}" 2> /dev/null \
    || [[ ! -s "${ca_path}" ]]; then
    if ! oc get secret router-ca -n openshift-ingress-operator \
      -o jsonpath='{.data.tls\.crt}' | base64 -d > "${ca_path}" 2> /dev/null \
      || [[ ! -s "${ca_path}" ]]; then
      log::error "Failed to extract ingress/router CA for mirror registry route"
      return 1
    fi
  fi
  export MIRROR_REGISTRY_CA="${ca_path}"

  local pull_secret_path="${mirror_dir}/pull-secret.json"
  local base_json="${mirror_dir}/base-pull-secret.json"
  if ! oc get secret pull-secret -n openshift-config \
    -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d > "${base_json}" 2> /dev/null \
    || [[ ! -s "${base_json}" ]]; then
    echo '{"auths":{}}' > "${base_json}"
  fi

  local token user auth_b64 whoami_user
  token=$(oc whoami -t) || {
    log::error "Failed to get oc token for registry auth"
    return 1
  }
  # Registry Basic auth is user:password. oc whoami for a ServiceAccount returns
  # system:serviceaccount:ns:name -- colons break parsing (user becomes "system").
  # Use a colon-free username; the token alone authenticates.
  whoami_user=$(oc whoami 2> /dev/null || true)
  if [[ "${whoami_user}" == system:serviceaccount:* ]]; then
    user="${whoami_user##*:}"
  elif [[ -n "${whoami_user}" && "${whoami_user}" != *:* ]]; then
    user="${whoami_user}"
  else
    user="unused"
  fi
  auth_b64=$(printf '%s' "${user}:${token}" | base64 -w0 2> /dev/null \
    || printf '%s' "${user}:${token}" | base64)

  jq -n \
    --slurpfile base "${base_json}" \
    --arg host "${MIRROR_REGISTRY_URL}" \
    --arg cluster_host "${MIRROR_REGISTRY_CLUSTER_URL}" \
    --arg auth "${auth_b64}" \
    --arg user "${user}" \
    --arg token "${token}" \
    '
    (($base[0] // {auths:{}}).auths // {}) as $auths |
    {
      auths: ($auths + {
        ($host): {
          auth: $auth,
          username: $user,
          password: $token
        },
        ($cluster_host): {
          auth: $auth,
          username: $user,
          password: $token
        }
      })
    }
    ' > "${pull_secret_path}" || {
    log::error "Failed to build pull-secret JSON for ${MIRROR_REGISTRY_URL}"
    return 1
  }

  # Merge vault/RH dockerconfig-style JSON from /tmp/secrets when present.
  if [[ -d /tmp/secrets ]]; then
    local secret_file
    while IFS= read -r -d '' secret_file; do
      if jq -e '.auths | type == "object"' "${secret_file}" > /dev/null 2>&1; then
        jq -s '.[0] * {auths: ((.[0].auths // {}) * (.[1].auths // {}))}' \
          "${pull_secret_path}" "${secret_file}" > "${pull_secret_path}.tmp" \
          && mv "${pull_secret_path}.tmp" "${pull_secret_path}"
      fi
    done < <(find /tmp/secrets -type f -print0 2> /dev/null || true)
  fi

  export MIRROR_REGISTRY_PULL_SECRET="${pull_secret_path}"
  export DISCONNECTED=true

  # aarch64 runners: OCP worker nodes and RHDH images are linux/amd64.
  disconnected::ensure_local_amd64_skopeo_shim || return 1

  # oc-mirror/skopeo push to <registry>/<project>/... The integrated registry
  # does not auto-create projects; pushing to a missing namespace uploads blobs
  # but rejects the manifest write ("denied"). Pre-create the push targets.
  disconnected::ensure_local_mirror_projects || return 1

  log::success "Local OCP mirror credentials under ${mirror_dir}"
  log::info "MIRROR_REGISTRY_PULL_SECRET=${MIRROR_REGISTRY_PULL_SECRET}"
  log::info "MIRROR_REGISTRY_CA=${MIRROR_REGISTRY_CA}"
}

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

# On aarch64/arm64, put a skopeo shim first on PATH that forces
# --override-os linux --override-arch amd64 for copy/inspect/etc.
# No-op on amd64 hosts.
disconnected::ensure_local_amd64_skopeo_shim() {
  local arch
  arch=$(uname -m)
  if [[ "${arch}" != "aarch64" && "${arch}" != "arm64" ]]; then
    return 0
  fi

  local real_skopeo
  real_skopeo=$(command -v skopeo) || {
    log::error "skopeo not found on PATH; required for local disconnected mirroring"
    return 1
  }
  # Avoid wrapping our own shim if setup_local_ocp_mirror is re-entered.
  if [[ "${real_skopeo}" == */disconnected-skopeo-shim/* ]]; then
    return 0
  fi

  local shim_dir="${DISCONNECTED_TMPDIR}/disconnected-skopeo-shim"
  mkdir -p "${shim_dir}"

  # Render the shim from a template, substituting ONLY ${REAL_SKOPEO} (the
  # single-quoted shell-format arg to envsubst leaves the shim's own $#/$1/$@
  # and ${cmd} runtime expansions untouched). Quote for safe reuse in the shim.
  local shim_template="${DIR}/resources/disconnected/skopeo-amd64-shim.sh.tpl"
  if [[ ! -f "${shim_template}" ]]; then
    log::error "skopeo shim template not found at ${shim_template}"
    return 1
  fi
  local REAL_SKOPEO
  REAL_SKOPEO=$(printf '%q' "${real_skopeo}")
  export REAL_SKOPEO
  # shellcheck disable=SC2016 # single-quoted shell-format is intentional for envsubst
  envsubst '${REAL_SKOPEO}' < "${shim_template}" > "${shim_dir}/skopeo" || {
    log::error "Failed to render skopeo shim from ${shim_template}"
    return 1
  }
  chmod +x "${shim_dir}/skopeo"
  export PATH="${shim_dir}:${PATH}"
  log::info "LOCAL_DISCONNECTED on ${arch}: skopeo shim forces linux/amd64 for OCP/RHDH images"
}

# Build a plugin-list file of digest-pinned oci:// refs from a catalog index.
# Skips fragile :tag refs that next catalogs sometimes publish without images.
# Args:
#   $1 - plugin_index (oci://...)
#   $2 - output list file path
disconnected::write_digest_plugin_list() {
  local plugin_index=$1
  local list_file=$2
  local index_ref="${plugin_index#oci://}"
  local extract_dir
  extract_dir=$(mktemp -d)

  log::info "Extracting catalog index for digest-only plugin list: ${plugin_index}"
  if ! skopeo copy "docker://${index_ref}" "dir:${extract_dir}/idx"; then
    log::error "Failed to extract catalog index ${index_ref}"
    rm -rf "${extract_dir}"
    return 1
  fi

  local data_dir="${extract_dir}/data"
  mkdir -p "${data_dir}"
  local layer
  for layer in "${extract_dir}/idx"/*; do
    if [[ -f "${layer}" && ! "${layer}" =~ (manifest\.json|version)$ ]]; then
      tar -xf "${layer}" -C "${data_dir}" 2> /dev/null || true
    fi
  done

  if [[ ! -f "${data_dir}/index.json" ]]; then
    log::error "No index.json in catalog index image"
    rm -rf "${extract_dir}"
    return 1
  fi

  : > "${list_file}"
  jq -r '
    .. | objects | .registryReference? // empty
  ' "${data_dir}/index.json" 2> /dev/null \
    | sed -E 's#^(oci://)?#oci://#' \
    | grep -E '@sha256:[0-9a-f]+' >> "${list_file}" || true

  if [[ -f "${data_dir}/dynamic-plugins.default.yaml" ]]; then
    grep -oE 'oci://[^[:space:]]+@sha256:[0-9a-f]+[^[:space:]]*' \
      "${data_dir}/dynamic-plugins.default.yaml" >> "${list_file}" || true
  fi

  # Deduplicate; strip !package suffix for skopeo (mirror-plugins accepts either).
  if [[ -s "${list_file}" ]]; then
    local tmp
    tmp=$(mktemp)
    sed -E 's/!.*//' "${list_file}" | sort -u > "${tmp}"
    mv "${tmp}" "${list_file}"
  fi

  local count
  count=$(wc -l < "${list_file}" | tr -d ' ')
  rm -rf "${extract_dir}"

  if [[ "${count}" -lt 1 ]]; then
    log::error "No digest-pinned plugins found in catalog index"
    return 1
  fi
  log::info "LOCAL_DISCONNECTED: ${count} digest-pinned plugins (tag-only refs skipped)"
}

# Pin CATALOG_INDEX_IMAGE from the Helm chart catalogIndex digest.
# RELEASE_VERSION=next is not published on registry.access.redhat.com, so
# mirror_plugins would otherwise abort.
# Uses HELM_CHART_URL / CHART_VERSION (and IMAGE_REGISTRY for GA vs CI chart).
disconnected::pin_local_catalog_index_from_chart() {
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    log::info "CATALOG_INDEX_IMAGE already set; skipping chart pin"
    return 0
  fi

  common::require_vars DISCONNECTED_TMPDIR HELM_CHART_URL || return 1

  local chart_version="${CHART_VERSION:-}"
  if [[ -z "${chart_version}" ]]; then
    log::error "CHART_VERSION is unset; cannot pin catalog index from chart"
    return 1
  fi

  local is_ga="false"
  if [[ "${IMAGE_REGISTRY:-}" == "registry.redhat.io" ]]; then
    is_ga="true"
  fi

  local pull_dir="${DISCONNECTED_TMPDIR}/local-catalog-chart"
  mkdir -p "${pull_dir}"
  rm -f "${pull_dir}"/*.tgz 2> /dev/null || true

  if [[ "${is_ga}" == "true" ]]; then
    helm repo add openshift-helm-charts https://charts.openshift.io 2> /dev/null || true
    helm repo update openshift-helm-charts
    log::info "Pulling GA chart for catalog pin (version: ${RELEASE_VERSION})"
    helm pull openshift-helm-charts/redhat-developer-hub \
      --version "${RELEASE_VERSION}" \
      -d "${pull_dir}" || {
      log::error "Failed to pull GA chart for catalog pin"
      return 1
    }
  else
    log::info "Pulling CI chart for catalog pin from ${HELM_CHART_URL} (version: ${chart_version})"
    helm pull "${HELM_CHART_URL}" --version "${chart_version}" \
      -d "${pull_dir}" || {
      log::error "Failed to pull chart for catalog pin"
      return 1
    }
  fi

  local chart_tgz
  chart_tgz=$(find "${pull_dir}" -maxdepth 1 -name '*.tgz' | head -1)
  if [[ -z "${chart_tgz}" ]]; then
    log::error "No chart .tgz found in ${pull_dir}"
    return 1
  fi

  local helm_values
  helm_values=$(helm show values "${chart_tgz}" 2> /dev/null || true)
  if [[ -z "${helm_values}" ]]; then
    log::error "helm show values returned empty for ${chart_tgz}"
    return 1
  fi

  local ci_registry ci_repo ci_tag ci_separator
  ci_registry=$(echo "${helm_values}" | yq '.global.catalogIndex.image.registry' || true)
  ci_repo=$(echo "${helm_values}" | yq '.global.catalogIndex.image.repository' || true)
  ci_tag=$(echo "${helm_values}" | yq '.global.catalogIndex.image.tag' || true)
  ci_registry="${ci_registry:-quay.io}"
  ci_repo="${ci_repo:-rhdh/plugin-catalog-index}"
  ci_tag="${ci_tag:-latest}"
  ci_separator=":"
  if [[ "${ci_repo}" == *"@"* ]]; then
    ci_separator="@${ci_repo##*@}:"
    ci_repo="${ci_repo%@*}"
  fi

  export CATALOG_INDEX_IMAGE="${ci_registry}/${ci_repo}${ci_separator}${ci_tag}"
  export CATALOG_INDEX_REGISTRY="${ci_registry}"
  if [[ "${ci_separator}" == @sha256: ]]; then
    export CATALOG_INDEX_REPO="${ci_repo}@sha256"
  else
    export CATALOG_INDEX_REPO="${ci_repo}"
  fi
  export CATALOG_INDEX_TAG="${ci_tag}"
  log::info "CATALOG_INDEX_IMAGE=${CATALOG_INDEX_IMAGE} (from chart values, LOCAL_DISCONNECTED)"
}

# Create ImageStream tags for digest-mirrored plugins by re-pushing each
# source@digest to <mirror>/<ns>/<name>:sha256-<digest>. The integrated
# registry only serves pulls through ImageStreams; digest-only skopeo pushes
# leave Image objects without stream tags -> HTTP 500/404 on pull.
# Args:
#   $1 - path to rhdh-plugin-mirroring-summary.txt
disconnected::ensure_local_plugin_imagestream_tags() {
  local summary=$1
  if [[ ! -f "${summary}" ]]; then
    log::error "Plugin mirroring summary not found at ${summary}"
    return 1
  fi

  common::require_vars MIRROR_REGISTRY_URL || return 1

  log::section "Ensuring ImageStream tags for mirrored plugins"
  local line src dest src_ref dest_path name ns digest tag dest_tagged
  local ok=0 fail=0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" != *"→"* && "${line}" != *"->"* ]] && continue
    if [[ "${line}" == *"→"* ]]; then
      src="${line%%→*}"
      dest="${line#*→}"
    else
      src="${line%%->*}"
      dest="${line#*->}"
    fi
    src=$(echo "${src}" | xargs)
    dest=$(echo "${dest}" | xargs)
    src_ref="${src#oci://}"
    dest="${dest#oci://}"
    dest="${dest#docker://}"
    [[ "${src_ref}" != *@sha256:* ]] && continue
    digest="${src_ref##*@}"
    [[ "${digest}" =~ ^sha256:[0-9a-f]+$ ]] || continue

    # dest like registry/ns/name@sha256:... or registry/ns/name:tag
    dest_path="${dest%%@*}"
    # Strip :tag only from the name segment (host has no port in local route case).
    if [[ "${dest_path}" == *"/"*":"* ]]; then
      dest_path="${dest_path%:*}"
    fi
    name="${dest_path##*/}"
    ns="${dest_path%/*}"
    ns="${ns##*/}"
    if [[ -z "${ns}" || -z "${name}" || "${ns}" == "${name}" ]]; then
      log::warn "Skipping unparsable mirror dest: ${dest}"
      continue
    fi

    # Push targets are data-driven by plugin source paths (e.g. rhdh,
    # rhdh-plugin-export-overlays). The integrated registry rejects manifest
    # writes to a missing project ("denied"); create it before pushing.
    disconnected::ensure_local_mirror_namespace "${ns}" || {
      log::error "Failed to ensure project ${ns} for ${ns}/${name}"
      fail=$((fail + 1))
      continue
    }

    tag="sha256-${digest#sha256:}"
    dest_tagged="${MIRROR_REGISTRY_URL}/${ns}/${name}:${tag}"
    log::info "Tagging ${ns}/${name}@${digest} -> :${tag}"
    if skopeo copy --remove-signatures --dest-tls-verify=false \
      "docker://${src_ref}" "docker://${dest_tagged}"; then
      ok=$((ok + 1))
    else
      log::error "Failed to create ImageStream tag for ${ns}/${name}"
      fail=$((fail + 1))
    fi
  done < "${summary}"

  if [[ "${fail}" -gt 0 ]]; then
    log::error "ImageStream tagging finished with ${fail} failure(s), ${ok} succeeded"
    return 1
  fi
  if [[ "${ok}" -eq 0 ]]; then
    log::warn "No digest-pinned plugins found to tag in ${summary}"
    return 0
  fi
  log::success "Created ImageStream tags for ${ok} mirrored plugins"
}
