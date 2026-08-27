#!/usr/bin/env bash
# Namespace-level secrets and CA trust for disconnected deployments.

[[ -n "${_DISCONNECTED_NAMESPACE_SOURCED:-}" ]] && return 0
readonly _DISCONNECTED_NAMESPACE_SOURCED=1

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

  # Preserve all top-level dockerconfigjson fields (e.g. HttpHeaders,
  # credHelpers) and only merge .auths; // {} guards against either side
  # lacking an auths object.
  merged=$(jq -n --argjson existing "${existing}" --argjson mirror "${mirror_auth}" \
    '$existing * $mirror | .auths = (($existing.auths // {}) + ($mirror.auths // {}))') || {
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
