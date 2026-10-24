#!/usr/bin/env bash
# OLM v1 operator install helpers and diagnostics.

[[ -n "${_DISCONNECTED_OPERATOR_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_OPERATOR_SOURCED=1

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
#
# The CRD alone is not proof of a successful install: with OLM v1 the bundle is
# applied as a Helm chart, so a release that fails halfway (e.g. the operator
# ClusterRole is refused) still leaves the CRD, the Deployment and a
# ClusterRoleBinding behind. The operator then runs without permissions and the
# job fails much later with a misleading "deployment not created". Require
# Installed=True as well.
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

  log::info "Waiting for ClusterExtension/${extension_name} Installed=True and CRD ${crd_name} (timeout: ${timeout}s)..."

  while ((elapsed < timeout)); do
    local installed
    installed=$(oc get clusterextension "${extension_name}" \
      -o jsonpath='{range .status.conditions[?(@.type=="Installed")]}{.status}{end}' 2> /dev/null || true)

    if [[ "${installed}" == "True" ]] && oc get crd "${crd_name}" > /dev/null 2>&1; then
      log::success "ClusterExtension/${extension_name} Installed=True; CRD '${crd_name}' is available"
      return 0
    fi

    # Info level on purpose: install errors (RBAC escalation, missing images)
    # are the useful signal in the build log when this wait times out.
    local progressing reason
    progressing=$(oc get clusterextension "${extension_name}" \
      -o jsonpath='{range .status.conditions[?(@.type=="Progressing")]}{.status}{end}' 2> /dev/null || true)
    reason=$(oc get clusterextension "${extension_name}" \
      -o jsonpath='{range .status.conditions[?(@.type=="Installed")]}{.reason}{": "}{.message}{end}' 2> /dev/null || true)
    log::info "ClusterExtension/${extension_name} Installed=${installed:-unknown} Progressing=${progressing:-unknown} ${reason}"

    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done

  log::error "Timeout waiting for ClusterExtension/${extension_name} Installed=True and CRD '${crd_name}' after ${timeout}s"
  disconnected::dump_olm_v1_status "${extension_name}"
  return 1
}

# TEMPORARY WORKAROUND — remove once the upstream fix is released.
#
# OLM v1 installs the bundle with a dedicated installer ServiceAccount, and the
# API server refuses to grant RBAC the installer does not hold itself
# ("attempting to grant RBAC permissions not currently held"). The ClusterRole
# rhdh-operator-installer-role rendered by prepare-restricted-environment.sh
# lags behind config/rbac/role.yaml (pods, apiservers/ingresses,
# devhubplugincatalogs were added to the operator without updating the
# installer role), so the operator ClusterRole cannot be created and the
# operator runs with no permissions.
#
# Grant the installer the operator's own rules, fetched from the same release
# branch the bundle comes from, so this cannot drift. Applied before prepare so
# the first install attempt already has the permissions.
# Args:
#   $1 - operator namespace (default: rhdh-operator)
#   $2 - installer ServiceAccount name (default: rhdh-operator-installer)
disconnected::grant_operator_installer_rbac() {
  local operator_ns=${1:-rhdh-operator}
  local installer_sa=${2:-rhdh-operator-installer}
  local role_name="${installer_sa}-bundle-permissions"
  local binding_name="${role_name}-binding"
  local role_url="https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME:-main}/config/rbac/role.yaml"
  local role_file="${DISCONNECTED_TMPDIR}/operator-installer-bundle-role.yaml"

  if [[ -z "${RELEASE_BRANCH_NAME:-}" ]]; then
    log::error "grant_operator_installer_rbac requires RELEASE_BRANCH_NAME"
    return 1
  fi

  log::info "Granting ${installer_sa} the operator ClusterRole rules (OLM v1 installer RBAC workaround)..."
  if ! curl -fL -o "${role_file}" "${role_url}"; then
    log::error "Failed to download ${role_url}"
    return 1
  fi

  if ! yq eval ".metadata.name = \"${role_name}\"" "${role_file}" | oc apply -f -; then
    log::error "Failed to apply ClusterRole ${role_name}"
    return 1
  fi

  if ! oc apply -f - << EOF; then
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${binding_name}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${role_name}
subjects:
- kind: ServiceAccount
  name: ${installer_sa}
  namespace: ${operator_ns}
EOF
    log::error "Failed to apply ClusterRoleBinding ${binding_name}"
    return 1
  fi

  cp "${role_file}" "${ARTIFACT_DIR}/disconnected-operator-installer-role-source.yaml" 2> /dev/null || true
  log::success "Installer SA ${installer_sa} may now grant the operator's ClusterRole"
}
