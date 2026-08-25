#!/usr/bin/env bash

# Shared utility functions for disconnected CI pipeline handlers.
# Provides environment validation, oc-mirror-based image mirroring,
# auth setup, and external script fetching.
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

# Create a dedicated temp directory for disconnected CI artifacts.
DISCONNECTED_TMPDIR=$(mktemp -d)
export DISCONNECTED_TMPDIR

# Validate that all required disconnected environment variables are set.
# These are exported by the step-registry commands.sh before calling
# openshift-ci-tests.sh.
disconnected::require_env() {
  if [[ "${DISCONNECTED:-}" != "true" ]]; then
    log::error "DISCONNECTED is not set to 'true'. This handler requires a disconnected environment."
    log::error "Ensure the step-registry commands.sh has run before this handler."
    return 1
  fi

  common::require_vars \
    MIRROR_REGISTRY_URL \
    MIRROR_REGISTRY_PULL_SECRET \
    MIRROR_REGISTRY_CA
}

# Configure container-tools authentication for skopeo, oc-mirror, and
# mirror-plugins.sh. Places the combined pull secret (which contains
# credentials for both source registries and the mirror registry) in
# the standard locations expected by these tools.
disconnected::setup_auth() {
  export HOME="${HOME:-/tmp/home}"
  export XDG_RUNTIME_DIR="${HOME}/run"
  mkdir -p "${XDG_RUNTIME_DIR}/containers"

  # oc-mirror and skopeo read auth from ${XDG_RUNTIME_DIR}/containers/auth.json
  cp "${MIRROR_REGISTRY_PULL_SECRET}" "${XDG_RUNTIME_DIR}/containers/auth.json"

  # REGISTRY_AUTH_FILE is respected by skopeo as an explicit override
  export REGISTRY_AUTH_FILE="${MIRROR_REGISTRY_PULL_SECRET}"

  # oc-mirror requires this to be unset
  unset REGISTRY_AUTH_PREFERENCE

  log::info "Container auth configured from ${MIRROR_REGISTRY_PULL_SECRET}"
}

# Wait until https://${MIRROR_REGISTRY_URL}/v2/ answers with something other
# than connection-failure (000) or HTTP 503. Shared by CI bastion and local
# integrated-registry modes — a 503 during Recreate/roll is not unique to either.
disconnected::wait_mirror_registry_route() {
  local timeout_s="${1:-900}"
  local interval_s=5
  local waited=0
  local probe_code=""

  if [[ -z "${MIRROR_REGISTRY_URL:-}" ]]; then
    log::error "MIRROR_REGISTRY_URL is unset; cannot probe mirror registry"
    return 1
  fi

  log::info "Probing mirror registry route until ready (timeout ${timeout_s}s)..."
  while ((waited < timeout_s)); do
    probe_code=$(curl -sk -o /dev/null -w '%{http_code}' \
      "https://${MIRROR_REGISTRY_URL}/v2/" || true)
    if [[ "${probe_code}" != "000" && "${probe_code}" != "503" ]]; then
      log::info "Mirror registry route ready (HTTP ${probe_code})"
      return 0
    fi
    sleep "${interval_s}"
    waited=$((waited + interval_s))
  done
  log::error "Mirror registry route still unavailable after ${timeout_s}s (HTTP ${probe_code:-none})"
  return 1
}

# LOCAL_DISCONNECTED: Recreate + RWO PVC (ceph-rbd) leaves the registry route
# at HTTP 503 for several minutes (Multi-Attach while the old pod releases the
# volume). ClusterOperator Available can still be True during that window.
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
# cluster pull-secret (prepare) and Recreate+RWO leave the route at HTTP 503
# for several minutes. Pass-through when LOCAL_DISCONNECTED is unset.
disconnected::retry_on_local_registry() {
  local max_attempts="${1:-5}"
  shift
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    "$@"
    return $?
  fi
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
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi

  if [[ -z "${SHARED_DIR:-}" ]]; then
    log::error "SHARED_DIR is unset; cannot write local disconnected mirror credentials"
    return 1
  fi

  local mirror_dir="${SHARED_DIR}/disconnected-mirror"
  mkdir -p "${mirror_dir}"

  log::section "Local disconnected: expose OCP image registry"
  # defaultRoute for push via ingress; disableRedirect for air-gapped-style push
  # (same as prepare-restricted-environment.sh on OCP).
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

  # Patching defaultRoute/disableRedirect restarts the registry Deployment; the
  # route can exist while pods are still rolling and return HTTP 503.
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

  # Pull secret usable as both containers auth.json and K8s .dockerconfigjson.
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
  # system:serviceaccount:ns:name — colons break parsing (user becomes "system").
  # Use a colon-free username; the token alone authenticates (same as
  # `podman login -u unused -p $(oc whoami -t)`).
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

  # Apple Silicon / aarch64 runners: OCP worker nodes and RHDH images are
  # linux/amd64. mirror-plugins.sh / skopeo default to host arch and fail with
  # "no image found in manifest list for architecture arm64".
  disconnected::ensure_local_amd64_skopeo_shim || return 1

  log::success "Local OCP mirror credentials under ${mirror_dir}"
  log::info "MIRROR_REGISTRY_PULL_SECRET=${MIRROR_REGISTRY_PULL_SECRET}"
  log::info "MIRROR_REGISTRY_CA=${MIRROR_REGISTRY_CA}"
}

# Allow the workload namespace to pull mirrored images from the integrated
# registry projects created by oc-mirror/skopeo (cross-namespace). Also attach
# a dockerconfig pull secret so kubelet can authenticate. LOCAL_DISCONNECTED only.
# Args:
#   $1 - namespace
disconnected::ensure_local_image_pull_access() {
  local namespace=$1
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi

  common::require_vars MIRROR_REGISTRY_PULL_SECRET || return 1

  local secret_name="mirror-registry-pull"
  local b64
  b64=$(base64 -w0 < "${MIRROR_REGISTRY_PULL_SECRET}" 2> /dev/null \
    || base64 < "${MIRROR_REGISTRY_PULL_SECRET}" | tr -d '\n')

  namespace::setup_image_pull_secret "${namespace}" "${secret_name}" "${b64}" || {
    log::error "Failed to create/link ${secret_name} in ${namespace}"
    return 1
  }

  # oc-mirror push path is <registry>/<project>/... — grant pull across those projects.
  local proj
  for proj in oc-mirror rhdh-community rhel9 rhdh; do
    if oc get project "${proj}" > /dev/null 2>&1 || oc get namespace "${proj}" > /dev/null 2>&1; then
      if oc adm policy add-role-to-group system:image-puller \
        "system:serviceaccounts:${namespace}" -n "${proj}" > /dev/null; then
        log::info "Granted system:image-puller on ${proj} to system:serviceaccounts:${namespace}"
      else
        log::warn "Failed to grant image-puller on ${proj} — continuing"
      fi
    fi
  done

  log::success "Local image pull access configured for ${namespace}"
}

# LOCAL_DISCONNECTED: after prepare --to-registry OCP_INTERNAL, catalogd/operator-controller
# must pull mirrored catalog/bundle images from the oc-mirror project. prepare grants
# image-puller on namespace "rhdh", not "oc-mirror", so ClusterCatalog stays
# Progressing with "authentication required". Also rewrite live IDMS/ITMS from the
# external registry route to the in-cluster service (kubelet/catalogd auth).
# No-op when LOCAL_DISCONNECTED is unset (CI bastion / external mirror).
disconnected::ensure_local_ocp_internal_olm_access() {
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi

  common::require_vars MIRROR_REGISTRY_URL MIRROR_REGISTRY_CLUSTER_URL || return 1

  log::section "Local disconnected: OLM access to OCP internal mirror"

  # prepare may roll the registry (defaultRoute/disableRedirect); wait it out so
  # catalogd does not flap on connection refused while unpacking.
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
        log::warn "Failed to grant image-puller on ${mirror_ns} to ${sa_ns} — continuing"
      fi
      # Explicit SA bindings (group grant is enough; SA bind helps older OCP policy UX).
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
    log::warn "Namespace ${mirror_ns} not found — skipping OLM image-puller grants"
  fi

  disconnected::rewrite_live_mirror_hosts_for_cluster || return 1
  log::success "LOCAL_DISCONNECTED OLM internal-registry access configured"
}

# Rewrite applied IDMS/ITMS resources: push-route host → in-cluster registry service.
# prepare/oc-mirror emit the external default-route; kubelet/catalogd need the svc.
disconnected::rewrite_live_mirror_hosts_for_cluster() {
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi
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
      log::info "Rewrote live ${kind}/${name}: ${MIRROR_REGISTRY_URL} → ${MIRROR_REGISTRY_CLUSTER_URL}"
    done < <(oc get "${kind}" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2> /dev/null || true)
  done
}

# Host used in IDMS/ITMS/Helm image refs for cluster pulls.
# LOCAL_DISCONNECTED: in-cluster integrated registry service (kubelet auth).
# CI bastion: external MIRROR_REGISTRY_URL unchanged.
disconnected::cluster_mirror_host() {
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" && -n "${MIRROR_REGISTRY_CLUSTER_URL:-}" ]]; then
    printf '%s' "${MIRROR_REGISTRY_CLUSTER_URL}"
  else
    printf '%s' "${MIRROR_REGISTRY_URL}"
  fi
}

# Rewrite oc-mirror IDMS/ITMS mirror host from the push route to the in-cluster
# registry service so kubelet can authenticate. No-op unless LOCAL_DISCONNECTED=1.
# Args:
#   $1 - yaml file path (IDMS or ITMS)
disconnected::rewrite_mirror_host_for_cluster() {
  local file=$1
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi
  if [[ -z "${MIRROR_REGISTRY_URL:-}" || -z "${MIRROR_REGISTRY_CLUSTER_URL:-}" ]]; then
    return 0
  fi
  if [[ ! -s "${file}" ]]; then
    return 0
  fi
  if grep -qF "${MIRROR_REGISTRY_URL}" "${file}"; then
    # Portable in-place rewrite (GNU/BSD sed).
    local tmp
    tmp=$(mktemp)
    sed "s|${MIRROR_REGISTRY_URL}|${MIRROR_REGISTRY_CLUSTER_URL}|g" "${file}" > "${tmp}"
    mv "${tmp}" "${file}"
    log::info "Rewrote mirror host in $(basename "${file}"): ${MIRROR_REGISTRY_URL} → ${MIRROR_REGISTRY_CLUSTER_URL}"
  fi
}

# When LOCAL_DISCONNECTED=1 on aarch64/arm64, put a skopeo shim first on PATH
# that forces --override-os linux --override-arch amd64 for copy/inspect/etc.
# No-op on amd64 hosts and when LOCAL_DISCONNECTED is unset (CI bastion).
disconnected::ensure_local_amd64_skopeo_shim() {
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi

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
  cat > "${shim_dir}/skopeo" << EOF
#!/usr/bin/env bash
# Auto-generated by disconnected::ensure_local_amd64_skopeo_shim — do not edit.
set -euo pipefail
real_skopeo=$(printf '%q' "${real_skopeo}")
if [[ \$# -lt 1 ]]; then
  exec "\${real_skopeo}"
fi
cmd=\$1
shift
case "\${cmd}" in
  copy | inspect | sync | delete | list-tags | tags | mount)
    exec "\${real_skopeo}" "\${cmd}" --override-os linux --override-arch amd64 "\$@"
    ;;
  *)
    exec "\${real_skopeo}" "\${cmd}" "\$@"
    ;;
esac
EOF
  chmod +x "${shim_dir}/skopeo"
  export PATH="${shim_dir}:${PATH}"
  log::info "LOCAL_DISCONNECTED on ${arch}: skopeo shim forces linux/amd64 for OCP/RHDH images"
}

# Build an ImageSetConfiguration for oc-mirror.
# The configuration is dynamically generated based on IMAGE_REGISTRY:
#   - registry.redhat.io (GA): uses helm.local with chart pulled from charts.openshift.io
#   - anything else (CI/upstream): uses helm.local with chart pulled from OCI
# Args:
#   $1 - output_path: Path to write the ImageSetConfiguration YAML
disconnected::build_imageset_config() {
  local output_path=$1

  # Start with the base config
  cat > "${output_path}" << EOF
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  helm:
    local:
      - name: redhat-developer-hub
        path: ${CHART_LOCAL_TGZ}
EOF

  # Add additional images that need mirroring beyond what the chart references.
  # The chart's default images are discovered automatically by oc-mirror.
  local additional_images=()

  # When the hub image is overridden (different from chart defaults), add it
  # so oc-mirror mirrors the actual image we'll deploy with.
  # LOCAL_DISCONNECTED: skip rhdh-community/rhdh:next. The integrated registry
  # cannot store that docker manifest list while oc-mirror preserve-digests
  # ("must be converted to OCI index … Instructed to preserve digests").
  # The chart already lists rhdh-hub-rhel9@sha256, which mirrors successfully.
  if [[ "${IMAGE_REGISTRY}" != "registry.redhat.io" && "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    additional_images+=("${IMAGE_REGISTRY}/${IMAGE_REPO}:${TAG_NAME}")
  elif [[ "${LOCAL_DISCONNECTED:-}" == "1" && "${IMAGE_REGISTRY}" != "registry.redhat.io" ]]; then
    log::info "LOCAL_DISCONNECTED: skipping additional image ${IMAGE_REGISTRY}/${IMAGE_REPO}:${TAG_NAME} (use chart hub digest)"
  fi

  # PG image: CI charts may use quay.io/fedora/postgresql-15 instead of
  # registry.redhat.io/rhel9/postgresql-15. Add it if not from registry.redhat.io.
  # PG_SEPARATOR accounts for digest (@sha256:) vs tag (:) encoding.
  if [[ "${PG_REGISTRY:-registry.redhat.io}" != "registry.redhat.io" ]]; then
    additional_images+=("${PG_REGISTRY}/${PG_REPO}${PG_SEPARATOR}${PG_TAG}")
  fi

  # Catalog index: the chart references it by digest and the init container
  # pulls it at startup. Must be mirrored so IDMS can redirect the pull.
  if [[ -n "${CI_REGISTRY:-}" && -n "${CI_REPO:-}" && -n "${CI_TAG:-}" ]]; then
    additional_images+=("${CI_REGISTRY}/${CI_REPO}${CI_SEPARATOR:-:}${CI_TAG}")
  fi

  if [[ ${#additional_images[@]} -gt 0 ]]; then
    {
      echo "  additionalImages:"
      for img in "${additional_images[@]}"; do
        echo "    - name: ${img}"
      done
    } >> "${output_path}"
  fi

  log::info "ImageSetConfiguration written to ${output_path}"
  log::debug "$(cat "${output_path}")"

  cp "${output_path}" "${ARTIFACT_DIR}/disconnected-imageset-config.yaml" 2> /dev/null || true
}

# Run a command with REGISTRY_AUTH_FILE unset, then restore it.
# oc-mirror (and prepare paths that invoke it) panic when REGISTRY_AUTH_FILE
# is set because distribution/distribution treats it as a storage driver
# config. Auth still comes from ${XDG_RUNTIME_DIR}/containers/auth.json
# (configured by disconnected::setup_auth).
disconnected::with_unset_registry_auth_file() {
  local saved_registry_auth_file="${REGISTRY_AUTH_FILE:-}"
  unset REGISTRY_AUTH_FILE

  local rc=0
  "$@" || rc=$?

  if [[ -n "${saved_registry_auth_file}" ]]; then
    export REGISTRY_AUTH_FILE="${saved_registry_auth_file}"
  fi
  return "${rc}"
}

# Run oc-mirror to mirror images to the disconnected mirror registry.
# Sets OC_MIRROR_IDMS_FILE, OC_MIRROR_ITMS_FILE, and OC_MIRROR_CHART_PATH.
# Args:
#   $1 - imageset_config: Path to the ImageSetConfiguration YAML
#   $2 - workspace_dir: Path to the oc-mirror workspace directory
disconnected::run_oc_mirror() {
  local imageset_config=$1
  local workspace_dir=$2

  mkdir -p "${workspace_dir}"

  # OpenShift's integrated registry rejects cosign/sigstore .sig attachments
  # ("writing signatures: ... name unknown") and can fail multi-arch copies with
  # preserve-digests. Strip signatures only for LOCAL_DISCONNECTED (OCP internal
  # registry). Bastion CI mirrors keep prior oc-mirror behavior.
  local oc_mirror_args=(
    -c "${imageset_config}"
    "docker://${MIRROR_REGISTRY_URL}"
    --dest-tls-verify=false
    --v2
    --workspace "file://${workspace_dir}"
  )
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    oc_mirror_args+=(--remove-signatures)
  fi

  log::info "Running oc-mirror --v2 → ${MIRROR_REGISTRY_URL} (${oc_mirror_args[*]})"
  if ! disconnected::retry_on_local_registry 5 \
    disconnected::with_unset_registry_auth_file oc-mirror "${oc_mirror_args[@]}"; then
    log::error "oc-mirror failed"
    return 1
  fi

  local result_dir="${workspace_dir}/working-dir"

  # IDMS (required)
  OC_MIRROR_IDMS_FILE="${result_dir}/cluster-resources/idms-oc-mirror.yaml"
  if [[ ! -s "${OC_MIRROR_IDMS_FILE}" ]]; then
    log::error "oc-mirror did not generate IDMS at ${OC_MIRROR_IDMS_FILE}"
    return 1
  fi
  export OC_MIRROR_IDMS_FILE

  # ITMS (optional)
  OC_MIRROR_ITMS_FILE="${result_dir}/cluster-resources/itms-oc-mirror.yaml"
  if [[ ! -s "${OC_MIRROR_ITMS_FILE}" ]]; then
    OC_MIRROR_ITMS_FILE=""
  fi
  export OC_MIRROR_ITMS_FILE

  # Chart path (in the workspace)
  OC_MIRROR_CHART_PATH=$(find "${result_dir}/helm/charts" -name '*.tgz' 2> /dev/null | head -1)
  export OC_MIRROR_CHART_PATH

  # Route → in-cluster service for kubelet-authenticated pulls (LOCAL_DISCONNECTED).
  disconnected::rewrite_mirror_host_for_cluster "${OC_MIRROR_IDMS_FILE}"
  if [[ -n "${OC_MIRROR_ITMS_FILE}" ]]; then
    disconnected::rewrite_mirror_host_for_cluster "${OC_MIRROR_ITMS_FILE}"
  fi

  log::success "oc-mirror completed successfully"
  log::info "IDMS: ${OC_MIRROR_IDMS_FILE}"
  [[ -n "${OC_MIRROR_ITMS_FILE}" ]] && log::info "ITMS: ${OC_MIRROR_ITMS_FILE}"
  [[ -n "${OC_MIRROR_CHART_PATH}" ]] && log::info "Chart: ${OC_MIRROR_CHART_PATH}"

  # Save artifacts for debugging
  cp "${OC_MIRROR_IDMS_FILE}" "${ARTIFACT_DIR}/disconnected-idms-generated.yaml" 2> /dev/null || true
  [[ -n "${OC_MIRROR_ITMS_FILE}" ]] && cp "${OC_MIRROR_ITMS_FILE}" "${ARTIFACT_DIR}/disconnected-itms-generated.yaml" 2> /dev/null || true
}

# Patch the oc-mirror-generated IDMS to ensure both quay.io and
# registry.redhat.io sources are covered, regardless of what oc-mirror
# discovered from the chart. This is needed because:
#   - GA charts reference registry.redhat.io but CI verification may override to quay.io
#   - CI charts reference quay.io but post-GA verification uses registry.redhat.io
# Args:
#   $1 - idms_file: Path to the IDMS YAML to patch
disconnected::patch_idms() {
  local idms_file=$1

  log::info "Patching IDMS with cross-registry mirror entries"

  local mirror_host
  mirror_host=$(disconnected::cluster_mirror_host)

  # Add mirror entries for the hub image from both registries
  for source_registry in "quay.io" "registry.redhat.io"; do
    local source="${source_registry}/${IMAGE_REPO}"
    local mirror="${mirror_host}/${IMAGE_REPO}"

    # Skip if this source is already in the IDMS
    if yq eval ".spec.imageDigestMirrors[].source" "${idms_file}" 2> /dev/null | grep -qF "${source}"; then
      log::debug "IDMS already contains entry for ${source}"
      continue
    fi

    yq eval -i \
      ".spec.imageDigestMirrors += [{\"mirrors\": [\"${mirror}\"], \"source\": \"${source}\"}]" \
      "${idms_file}"
    log::info "Added IDMS entry: ${source} → ${mirror}"
  done

  # Add mirror entry for PG image if not already present.
  # PG_REPO is already cleaned of @sha256 by the caller (via PG_SEPARATOR).
  if [[ -n "${PG_REGISTRY:-}" && -n "${PG_REPO:-}" ]]; then
    local pg_source="${PG_REGISTRY}/${PG_REPO}"
    local pg_mirror="${mirror_host}/${PG_REPO}"

    if ! yq eval ".spec.imageDigestMirrors[].source" "${idms_file}" 2> /dev/null | grep -qF "${pg_source}"; then
      yq eval -i \
        ".spec.imageDigestMirrors += [{\"mirrors\": [\"${pg_mirror}\"], \"source\": \"${pg_source}\"}]" \
        "${idms_file}"
      log::info "Added IDMS entry: ${pg_source} → ${pg_mirror}"
    fi
  fi

  log::debug "Patched IDMS:"
  log::debug "$(cat "${idms_file}")"

  cp "${idms_file}" "${ARTIFACT_DIR}/disconnected-idms-patched.yaml" 2> /dev/null || true
}

# Fetch an external script from the rhdh-operator repository.
# Args:
#   $1 - script_name: Name of the script (e.g., "mirror-plugins.sh")
#   $2 - output_path: Local path to save the script
#   $3 - ref: (optional) Branch name, 40-char commit SHA, or pull request
#             ref ("pull/<n>" / "refs/pull/<n>/head"). Defaults to
#             $RELEASE_BRANCH_NAME.
disconnected::fetch_script() {
  local script_name=$1
  local output_path=$2
  local ref="${3:-${RELEASE_BRANCH_NAME}}"
  local url
  local ref_label
  local pull_number

  if [[ "${ref}" =~ ^[0-9a-f]{40}$ ]]; then
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/${ref}/.rhdh/scripts/${script_name}"
    ref_label="sha: ${ref}"
  elif [[ "${ref}" =~ ^(refs/)?pull/([0-9]+)(/head)?$ ]]; then
    # Always the current PR head (updates as the PR is pushed).
    pull_number="${BASH_REMATCH[2]}"
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/pull/${pull_number}/head/.rhdh/scripts/${script_name}"
    ref_label="pull/${pull_number} head"
  else
    url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${ref}/.rhdh/scripts/${script_name}"
    ref_label="branch: ${ref}"
  fi

  log::info "Fetching ${script_name} from rhdh-operator (${ref_label})..."
  if ! curl -fL --max-time 30 -o "${output_path}" "${url}"; then
    log::error "Failed to download ${script_name} from ${url}"
    return 1
  fi
  chmod +x "${output_path}"
  log::success "Downloaded ${script_name} to ${output_path}"
}

# Wait for MachineConfigPool updates after IDMS/CatalogSource changes.
# Warns and continues on timeout (same behavior as both handlers historically).
disconnected::wait_mcp_updated() {
  log::info "Waiting for MachineConfigPool updates to complete (up to 20m)..."
  if ! oc wait machineconfigpool --all --for=condition=Updated=True --timeout=20m; then
    log::warn "MachineConfigPool wait timed out — proceeding anyway"
  fi
  log::success "All MachineConfigPools are Updated"
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
  # Prefer registryReference digests from index.json; also accept oci://…@sha256 from defaults.
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

# LOCAL_DISCONNECTED: pin CATALOG_INDEX_IMAGE from the Helm chart catalogIndex
# digest. RELEASE_VERSION=next is not published on registry.access.redhat.com, so
# mirror_plugins would otherwise abort. No-op when unset LOCAL or already set.
# Uses HELM_CHART_URL / CHART_VERSION (and IMAGE_REGISTRY for GA vs CI chart).
disconnected::pin_local_catalog_index_from_chart() {
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi
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
  common::normalize_chart_image_ref ci_repo ci_tag ci_separator

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

# Fetch and run mirror-plugins.sh against the disconnected mirror registry.
# Uses CATALOG_INDEX_IMAGE when set; otherwise the GA plugin-catalog-index tag.
# LOCAL_DISCONNECTED: mirror digest-pinned plugins only (next catalogs can list
# missing :tag refs that abort mirror-plugins.sh), then mirror the catalog index.
disconnected::mirror_plugins() {
  local mirror_script="${DISCONNECTED_TMPDIR}/mirror-plugins.sh"

  disconnected::fetch_script "mirror-plugins.sh" "${mirror_script}" || {
    log::error "Failed to fetch mirror-plugins.sh — aborting"
    return 1
  }

  local plugin_index="oci://registry.access.redhat.com/rhdh/plugin-catalog-index:${RELEASE_VERSION}"
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    plugin_index="oci://${CATALOG_INDEX_IMAGE}"
  fi

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    local list_file="${DISCONNECTED_TMPDIR}/local-digest-plugins.txt"
    disconnected::write_digest_plugin_list "${plugin_index}" "${list_file}" || return 1

    # --plugin-list only (not --plugin-index): index mode re-adds fragile tags.
    # Catalog index is mirrored after plugins so the summary still records it.
    # Recreate + RWO often 503s the route after prepare/IDMS; wait and retry.
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
      log::error "mirror-plugins.sh (digest-only list) failed after ${max_attempts} attempts — aborting"
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
        real_skopeo=$(PATH="${PATH#${real_skopeo%/*}:}" type -P skopeo) || break
      done
    fi
    log::info "Mirroring catalog index → ${catalog_dest} (skopeo --all)"
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
      echo "${plugin_index} → oci://${catalog_dest}" >> "${summary_src}"
    fi
  else
    disconnected::wait_mirror_registry_route 300 || return 1
    bash "${mirror_script}" \
      --plugin-index "${plugin_index}" \
      --to-registry "${MIRROR_REGISTRY_URL}" || {
      log::error "mirror-plugins.sh failed — aborting"
      return 1
    }
  fi

  # mirror-plugins.sh writes the summary to ORIGINAL_DIR (pwd at script start).
  local summary_src
  summary_src="$(pwd)/rhdh-plugin-mirroring-summary.txt"
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

  # OpenShift integrated registry only serves pulls through ImageStreams. Digest-only
  # skopeo pushes leave Image objects without stream tags → HTTP 500/404 on pull.
  # Re-push each mirrored digest under an explicit tag so ImageStreams stick.
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::ensure_local_plugin_imagestream_tags "${summary_src}" || return 1
  fi
}

# LOCAL_DISCONNECTED: create ImageStream tags for digest-mirrored plugins by
# re-pushing each source@digest to <mirror>/<ns>/<name>:sha256-<digest>.
# Args:
#   $1 - path to rhdh-plugin-mirroring-summary.txt
disconnected::ensure_local_plugin_imagestream_tags() {
  local summary=$1
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    return 0
  fi
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
    # Summary uses either → or -> between source and dest.
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
    # Drop a trailing :tag if present (host has no port in our local route case;
    # tagged dests are host/ns/name:tag — strip :tag only from the name segment).
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

    tag="sha256-${digest#sha256:}"
    dest_tagged="${MIRROR_REGISTRY_URL}/${ns}/${name}:${tag}"
    log::info "Tagging ${ns}/${name}@${digest} → :${tag}"
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

# Resolve the mirrored plugin-catalog-index to a digest-pinned CATALOG_INDEX_IMAGE.
# Hub profile defaults often pin a digest that was never mirrored; inject the digest
# actually pushed by mirror-plugins so registries.conf can rewrite pulls to the mirror.
# Exports CATALOG_INDEX_IMAGE=registry.access.redhat.com/rhdh/plugin-catalog-index@sha256:…
disconnected::resolve_catalog_index_image() {
  common::require_vars MIRROR_REGISTRY_URL RELEASE_VERSION || return 1

  local summary="${DISCONNECTED_TMPDIR}/rhdh-plugin-mirroring-summary.txt"
  local name="plugin-catalog-index"
  local line=""
  local left=""
  local right=""
  local digest=""

  if [[ ! -f "${summary}" ]]; then
    log::error "Plugin mirroring summary not found at ${summary}"
    log::error "Ensure disconnected::mirror_plugins ran successfully before resolve."
    return 1
  fi

  line=$(grep -F "${name}" "${summary}" | head -1) || true
  if [[ -z "${line}" ]]; then
    log::error "No summary line for ${name} in ${summary}"
    return 1
  fi

  # Summary format: <source-ref> → <mirror-ref>
  left="${line%%→*}"
  right="${line#*→}"
  right="${right#"${right%%[![:space:]]*}"}"

  if [[ "${left}" =~ @(sha256:[0-9a-f]+) ]]; then
    digest="${BASH_REMATCH[1]}"
  elif [[ "${right}" =~ @(sha256:[0-9a-f]+) ]]; then
    digest="${BASH_REMATCH[1]}"
  else
    # Tag-only mapping (e.g. …/plugin-catalog-index:next) — resolve digest from mirror.
    local tag="${RELEASE_VERSION}"
    if [[ "${right}" =~ :([^:@/[:space:]]+)[[:space:]]*$ ]]; then
      tag="${BASH_REMATCH[1]}"
    elif [[ "${left}" =~ :([^:@/[:space:]]+)[[:space:]]*$ ]]; then
      tag="${BASH_REMATCH[1]}"
    fi
    log::info "Catalog index summary has no digest; inspecting mirror tag :${tag}"
    digest=$(skopeo inspect --tls-verify=false \
      "docker://${MIRROR_REGISTRY_URL}/rhdh/${name}:${tag}" \
      --format '{{.Digest}}') || {
      log::error "Failed to inspect docker://${MIRROR_REGISTRY_URL}/rhdh/${name}:${tag}"
      return 1
    }
  fi

  if [[ -z "${digest}" || "${digest}" != sha256:* ]]; then
    log::error "Could not resolve digest for mirrored ${name} (got '${digest}')"
    return 1
  fi

  export CATALOG_INDEX_REGISTRY="registry.access.redhat.com"
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    # Integrated registry ImageStreams are pullable by :sha256-<digest> tags.
    # Pulling the source multi-arch list digest returns manifest unknown.
    export CATALOG_INDEX_REPO="rhdh/${name}"
    export CATALOG_INDEX_TAG="sha256-${digest#sha256:}"
    export CATALOG_INDEX_IMAGE="${CATALOG_INDEX_REGISTRY}/${CATALOG_INDEX_REPO}:${CATALOG_INDEX_TAG}"
    log::success "CATALOG_INDEX_IMAGE=${CATALOG_INDEX_IMAGE} (ImageStream tag, LOCAL_DISCONNECTED)"
  else
    export CATALOG_INDEX_REPO="rhdh/${name}@sha256"
    export CATALOG_INDEX_TAG="${digest#sha256:}"
    export CATALOG_INDEX_IMAGE="${CATALOG_INDEX_REGISTRY}/rhdh/${name}@${digest}"
    log::success "CATALOG_INDEX_IMAGE=${CATALOG_INDEX_IMAGE} (mirrored catalog digest)"
  fi
}

# Create a minimal dynamic-plugins ConfigMap that enables the homepage plugin.
# Args:
#   $1 - namespace
disconnected::create_homepage_plugins_configmap() {
  local namespace=$1
  local cm_name="dynamic-plugins-disconnected-smoke"
  local plugins_yaml="${DIR}/resources/disconnected/dynamic-plugins-disconnected-smoke.yaml"

  if [[ ! -f "${plugins_yaml}" ]]; then
    log::error "Disconnected smoke dynamic-plugins YAML not found at ${plugins_yaml}"
    return 1
  fi

  oc create configmap "${cm_name}" \
    --from-file="dynamic-plugins.yaml=${plugins_yaml}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create ${cm_name} ConfigMap — aborting"
    return 1
  }
  cp "${plugins_yaml}" "${ARTIFACT_DIR}/disconnected-dynamic-plugins.yaml" 2> /dev/null || true
  log::success "ConfigMap ${cm_name} created in ${namespace}"
}

# Wrap the Operator homepage plugin YAML as Helm values (global.dynamic).
# The chart templates that object into ${RELEASE_NAME}-dynamic-plugins.
# Args:
#   $1 - destination Helm values path
disconnected::write_homepage_helm_values() {
  local dest=$1
  local plugins_yaml="${DIR}/resources/disconnected/dynamic-plugins-disconnected-smoke.yaml"

  if [[ ! -f "${plugins_yaml}" ]]; then
    log::error "Disconnected smoke dynamic-plugins YAML not found at ${plugins_yaml}"
    return 1
  fi

  yq eval '{"global": {"dynamic": .}}' "${plugins_yaml}" > "${dest}" || {
    log::error "Failed to wrap homepage plugins as Helm values"
    return 1
  }
  cp "${dest}" "${ARTIFACT_DIR}/disconnected-helm-homepage-values.yaml" 2> /dev/null || true
  log::success "Helm homepage values written to ${dest}"
}

# Apply the shared plugin-mirror registries.conf ConfigMap in a namespace.
# Args:
#   $1 - namespace
disconnected::apply_plugin_mirror_configmap() {
  local namespace=$1
  local policy_file="${DIR}/resources/disconnected/policy.json"
  local registries_tpl="${DIR}/resources/disconnected/plugin-mirror-registries.conf.tpl"
  local registries_file="${DISCONNECTED_TMPDIR}/plugin-mirror-registries.conf"

  if [[ ! -f "${policy_file}" ]]; then
    log::error "Disconnected policy.json not found at ${policy_file}"
    return 1
  fi

  envsubst < "${registries_tpl}" > "${registries_file}" || {
    log::error "Failed to render plugin mirror registries.conf template"
    return 1
  }

  oc create configmap rhdh-plugin-mirror-conf \
    --from-file="rhdh-registries.conf=${registries_file}" \
    --from-file="policy.json=${policy_file}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create registries.conf ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-conf created in ${namespace}"

  oc get configmap rhdh-plugin-mirror-conf -n "${namespace}" -o yaml \
    > "${ARTIFACT_DIR}/disconnected-plugin-mirror-configmap.yaml" 2> /dev/null || true
}

# Create the per-namespace mirror CA ConfigMap used by install-dynamic-plugins
# (mounted at /etc/containers/certs.d/<registry>/ca.crt so skopeo trusts TLS).
# Args:
#   $1 - namespace
disconnected::create_mirror_registry_ca_configmap() {
  local namespace=$1

  if [[ ! -f "${MIRROR_REGISTRY_CA}" ]]; then
    log::error "MIRROR_REGISTRY_CA file not found: ${MIRROR_REGISTRY_CA}"
    return 1
  fi

  oc create configmap mirror-registry-ca \
    --from-file="ca.crt=${MIRROR_REGISTRY_CA}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create mirror-registry-ca ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap mirror-registry-ca created in ${namespace}"
}

# Create the registry auth secret for the install-dynamic-plugins init container.
# Args:
#   $1 - namespace
#   $2 - secret name (default: ${RELEASE_NAME}-dynamic-plugins-registry-auth)
disconnected::create_plugin_registry_auth_secret() {
  local namespace=$1
  local secret_name=${2:-${RELEASE_NAME}-dynamic-plugins-registry-auth}

  oc create secret generic "${secret_name}" \
    --from-file="auth.json=${MIRROR_REGISTRY_PULL_SECRET}" \
    -n "${namespace}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create registry auth secret — aborting"
    return 1
  }
  log::success "Secret ${secret_name} created in ${namespace}"
}

# Ensure the mirror registry CA is trusted cluster-wide via
# image.config.openshift.io/cluster additionalTrustedCA so OLM v1 catalogd
# can pull ClusterCatalog images (x509 unknown authority otherwise).
# Triggers an MCP update; callers should run disconnected::wait_mcp_updated after.
disconnected::ensure_mirror_registry_ca() {
  local registry_host="${MIRROR_REGISTRY_URL%%/*}"
  # OpenShift ConfigMap keys use ".." in place of ":" for host:port.
  local cm_key="${registry_host//:/..}"
  local cm_name="rhdh-disconnected-mirror-ca"
  local existing_cm

  if [[ ! -f "${MIRROR_REGISTRY_CA}" ]]; then
    log::error "MIRROR_REGISTRY_CA file not found: ${MIRROR_REGISTRY_CA}"
    return 1
  fi

  existing_cm=$(oc get image.config.openshift.io/cluster -o jsonpath='{.spec.additionalTrustedCA.name}' 2> /dev/null || true)
  if [[ -n "${existing_cm}" ]]; then
    cm_name="${existing_cm}"
    log::info "Merging mirror CA into existing additionalTrustedCA ConfigMap ${cm_name}"
    oc get configmap "${cm_name}" -n openshift-config -o json \
      | jq --arg key "${cm_key}" --rawfile cert "${MIRROR_REGISTRY_CA}" \
        '.data[$key] = $cert | del(.metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp)' \
      | oc apply -f - || {
      log::error "Failed to merge mirror CA into ConfigMap ${cm_name}"
      return 1
    }
  else
    log::info "Creating additionalTrustedCA ConfigMap ${cm_name} for ${registry_host}"
    oc create configmap "${cm_name}" -n openshift-config \
      --from-file="${cm_key}=${MIRROR_REGISTRY_CA}" \
      --dry-run=client -o yaml | oc apply -f - || {
      log::error "Failed to create ConfigMap ${cm_name}"
      return 1
    }
    oc patch image.config.openshift.io/cluster --type=merge \
      -p "{\"spec\":{\"additionalTrustedCA\":{\"name\":\"${cm_name}\"}}}" || {
      log::error "Failed to patch image.config.openshift.io/cluster additionalTrustedCA"
      return 1
    }
  fi

  log::success "Mirror CA trusted for ${registry_host} via ${cm_name}/${cm_key}"
}

# Merge mirror-registry credentials into openshift-config/pull-secret so OLM v1
# catalogd/operator-controller can pull mirrored catalog/bundle images.
# prepare-restricted-environment.sh skips this for external registries.
disconnected::ensure_olm_mirror_pull_secret() {
  local existing mirror_auth merged

  existing=$(oc get secret pull-secret -n openshift-config -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d) || {
    log::error "Failed to read openshift-config/pull-secret"
    return 1
  }
  mirror_auth=$(cat "${MIRROR_REGISTRY_PULL_SECRET}") || {
    log::error "Failed to read ${MIRROR_REGISTRY_PULL_SECRET}"
    return 1
  }

  merged=$(jq -n --argjson existing "${existing}" --argjson mirror "${mirror_auth}" \
    '{auths: ($existing.auths + $mirror.auths)}') || {
    log::error "Failed to merge mirror credentials into pull-secret JSON"
    return 1
  }

  echo "${merged}" | oc set data secret/pull-secret -n openshift-config \
    --from-file=.dockerconfigjson=/dev/stdin || {
    log::error "Failed to update openshift-config/pull-secret with mirror credentials"
    return 1
  }
  log::success "Merged mirror registry credentials into openshift-config/pull-secret"
}

# Dump OLM v1 install status for debugging when the operator CRD never appears.
disconnected::dump_olm_v1_status() {
  local extension_name=${1:-rhdh-operator}
  local catalog_name=${2:-rhdh-catalog}
  local operator_ns=${3:-rhdh-operator}

  log::info "Dumping OLM v1 status (ClusterCatalog/ClusterExtension/pods)..."
  oc get clustercatalog "${catalog_name}" -o yaml > "${ARTIFACT_DIR}/disconnected-clustercatalog.yaml" 2> /dev/null || true
  oc get clusterextension "${extension_name}" -o yaml > "${ARTIFACT_DIR}/disconnected-clusterextension.yaml" 2> /dev/null || true
  oc get clustercatalog "${catalog_name}" -o wide 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc get clusterextension "${extension_name}" -o wide 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc describe clusterextension "${extension_name}" 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc get pods -n "${operator_ns}" -o wide 2>&1 | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
  oc get events -n "${operator_ns}" --sort-by='.lastTimestamp' 2>&1 | tail -50 \
    | tee -a "${ARTIFACT_DIR}/disconnected-olm-v1-status.txt" || true
}

# Wait for OLM v1 ClusterExtension to report Installed, then for the CRD.
# Args:
#   $1 - extension name (default: rhdh-operator)
#   $2 - crd name (default: backstages.rhdh.redhat.com)
#   $3 - timeout seconds (default: 600)
disconnected::wait_operator_crd_olm_v1() {
  local extension_name=${1:-rhdh-operator}
  local crd_name=${2:-backstages.rhdh.redhat.com}
  local timeout=${3:-600}
  local interval=15
  local elapsed=0

  log::info "Waiting for ClusterExtension/${extension_name} and CRD ${crd_name} (timeout: ${timeout}s)..."

  while ((elapsed < timeout)); do
    if oc get crd "${crd_name}" > /dev/null 2>&1; then
      log::success "CRD '${crd_name}' is available"
      return 0
    fi

    local installed
    installed=$(oc get clusterextension "${extension_name}" \
      -o jsonpath='{range .status.conditions[?(@.type=="Installed")]}{.status}{end}' 2> /dev/null || true)
    if [[ "${installed}" == "True" ]]; then
      log::info "ClusterExtension/${extension_name} reports Installed=True; waiting for CRD..."
    else
      local progressing reason
      progressing=$(oc get clusterextension "${extension_name}" \
        -o jsonpath='{range .status.conditions[?(@.type=="Progressing")]}{.status}{end}' 2> /dev/null || true)
      reason=$(oc get clusterextension "${extension_name}" \
        -o jsonpath='{range .status.conditions[?(@.type=="Installed")]}{.reason}{" "}{.message}{end}' 2> /dev/null || true)
      log::debug "ClusterExtension Installed=${installed:-unknown} Progressing=${progressing:-unknown} ${reason}"
    fi

    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done

  log::error "Timeout waiting for CRD '${crd_name}' after ${timeout}s"
  disconnected::dump_olm_v1_status "${extension_name}"
  return 1
}

# Helm hub can finish install-dynamic-plugins and start the backend during
# first-boot Postgres initdb. Plugin init then fails with ECONNREFUSED, but
# the process stays up (liveness 200, readiness 503) so kubelet never restarts
# it. Wait for Postgres Ready, then bounce the hub only if it is not Available.
# No-op when the hub becomes Ready after Postgres (typical local timing).
# Args:
#   $1 - namespace
#   $2 - Helm release name (default: rhdh)
#   $3 - Postgres Ready timeout seconds (default: 300)
#   $4 - Hub Available grace seconds before restart (default: 30)
#   $5 - Hub rollout timeout seconds after restart (default: 300)
disconnected::ensure_helm_hub_after_postgres() {
  local namespace=$1
  local release_name=${2:-rhdh}
  local pg_timeout=${3:-300}
  local hub_grace=${4:-30}
  local rollout_timeout=${5:-300}

  if [[ -z "${namespace}" ]]; then
    log::error "disconnected::ensure_helm_hub_after_postgres requires a namespace"
    return 1
  fi

  local pg_pod="${release_name}-postgresql-0"
  local hub_deploy="${release_name}-developer-hub"
  local pg_ready=0
  local start=$SECONDS

  log::info "Waiting for ${pg_pod} Ready (timeout ${pg_timeout}s)..."
  while ((SECONDS - start < pg_timeout)); do
    if oc get "pod/${pg_pod}" -n "${namespace}" > /dev/null 2>&1; then
      if oc wait --for=condition=Ready "pod/${pg_pod}" -n "${namespace}" --timeout=15s; then
        log::success "PostgreSQL ${pg_pod} is Ready"
        pg_ready=1
        break
      fi
    else
      log::info "${pg_pod} not created yet"
      sleep 5
    fi
  done
  if [[ "${pg_ready}" -ne 1 ]]; then
    log::error "PostgreSQL ${pg_pod} not Ready after ${pg_timeout}s"
    oc get pods -n "${namespace}" || true
    oc logs "pod/${pg_pod}" -n "${namespace}" --tail=80 || true
    return 1
  fi

  if oc wait --for=condition=Available "deployment/${hub_deploy}" \
    -n "${namespace}" --timeout="${hub_grace}s"; then
    log::success "Hub ${hub_deploy} already Available — skipping restart"
    return 0
  fi

  log::warn "Hub ${hub_deploy} not Available after Postgres Ready — restarting to recover from DB connect race"
  oc get pods -n "${namespace}" || true
  local -a hub_pods=()
  mapfile -t hub_pods < <(oc get pod -n "${namespace}" \
    -l "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=${release_name}" \
    -o name 2> /dev/null || true)
  if [[ ${#hub_pods[@]} -eq 0 || -z "${hub_pods[0]:-}" ]]; then
    log::error "No hub pods matched app.kubernetes.io/component=backstage in ${namespace}"
    return 1
  fi
  if ! oc delete -n "${namespace}" "${hub_pods[@]}"; then
    log::error "Failed to delete hub pods in ${namespace}"
    return 1
  fi
  if ! oc rollout status "deployment/${hub_deploy}" -n "${namespace}" --timeout="${rollout_timeout}s"; then
    log::error "Hub ${hub_deploy} did not become Available after restart"
    oc get pods -n "${namespace}" || true
    oc logs "deployment/${hub_deploy}" -n "${namespace}" --tail=80 --all-containers=true || true
    return 1
  fi
  log::success "Hub ${hub_deploy} Available after restart"
}
