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
