#!/usr/bin/env bash
# LOCAL_DISCONNECTED integrated-registry bring-up: wait for the cluster image
# registry, retry-on-503 wrapper, MIRROR_* bootstrap from the cluster route, and
# the amd64 skopeo shim for local push. Sourced only when LOCAL_DISCONNECTED=1.

[[ -n "${_DISCONNECTED_LOCAL_REGISTRY_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_LOCAL_REGISTRY_SOURCED=1

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
