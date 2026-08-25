#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_ocp_fips_helm() {
  export NAME_SPACE="${NAME_SPACE:-showcase-fips-nightly}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  fips_deployment "${PW_PROJECT_SHOWCASE_FIPS}"

  deploy_test_backstage_customization_provider "${NAME_SPACE}"

  run_standard_deployment_tests
}

# Same shape as base_deployment() in utils.sh, but merges diff-values_showcase-fips.yaml
# onto values_showcase.yaml, since base_deployment()/helm::install() are hardwired to
# the default values_showcase.yaml.
fips_deployment() {
  common::require_vars "RELEASE_NAME" "TAG_NAME" "IMAGE_REGISTRY" "IMAGE_REPO" "K8S_CLUSTER_ROUTER_BASE" || return 1
  local artifacts_subdir=$1
  local fips_diff_value_file="${DIR}/value_files/diff-values_showcase-fips.yaml"
  local fips_merged_value_file="/tmp/merged-values_showcase-fips.yaml"

  namespace::configure "${NAME_SPACE}"

  deploy_redis_cache "${NAME_SPACE}"

  cd "${DIR}" || exit
  local rhdh_base_url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${NAME_SPACE}" "${rhdh_base_url}"

  helm::merge_values "overwrite" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${fips_diff_value_file}" "${fips_merged_value_file}"
  common::save_artifact "${artifacts_subdir}" "${fips_merged_value_file}" || true

  log::info "Deploying image from repository: ${IMAGE_REGISTRY}/${IMAGE_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${fips_merged_value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params)
}

# Extract OpenShift cluster CA certificate and configure Playwright to trust it
# This is required for FIPS-enabled clusters to avoid ERR_CERT_AUTHORITY_INVALID
# Returns:
#   0 - Certificate extracted and configured successfully
#   1 - Failed to extract certificate
configure_openshift_ca_for_playwright() {
  log::info "Extracting OpenShift cluster CA certificates for Playwright..."

  local ca_cert_dir="${ARTIFACT_DIR:-/tmp}/cluster-certs"
  local ca_cert_file="${ca_cert_dir}/openshift-ca-bundle.crt"
  local temp_cert_file="${ca_cert_dir}/temp-cert.crt"
  local extracted_count=0

  mkdir -p "${ca_cert_dir}"
  rm -f "${ca_cert_file}" "${temp_cert_file}"

  # Source 1: Extract CA bundle from default-ingress-cert configmap
  if oc get configmap default-ingress-cert -n openshift-config-managed -o jsonpath='{.data.ca-bundle\.crt}' 2> /dev/null > "${temp_cert_file}" && [[ -s "${temp_cert_file}" ]]; then
    log::success "✓ Extracted CA bundle from default-ingress-cert configmap"
    cat "${temp_cert_file}" >> "${ca_cert_file}"
    extracted_count=$((extracted_count + 1))
    rm -f "${temp_cert_file}"
  else
    log::info "✗ Could not extract from default-ingress-cert configmap"
  fi

  # Source 2: Extract from router-ca secret in openshift-ingress-operator
  if oc get secret router-ca -n openshift-ingress-operator -o jsonpath='{.data.tls\.crt}' 2> /dev/null | base64 --decode > "${temp_cert_file}" && [[ -s "${temp_cert_file}" ]]; then
    log::success "✓ Extracted CA from router-ca secret"
    cat "${temp_cert_file}" >> "${ca_cert_file}"
    extracted_count=$((extracted_count + 1))
    rm -f "${temp_cert_file}"
  else
    log::info "✗ Could not extract from router-ca secret"
  fi

  # Source 3: Extract certificate chain from console route via openssl
  if command -v openssl &> /dev/null && [[ -n "${K8S_CLUSTER_ROUTER_BASE:-}" ]]; then
    local console_route="console-openshift-console.${K8S_CLUSTER_ROUTER_BASE}"
    if echo | openssl s_client -connect "${console_route}:443" -showcerts 2> /dev/null \
      | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' > "${temp_cert_file}" && [[ -s "${temp_cert_file}" ]]; then
      log::success "✓ Extracted certificate chain from console route"
      cat "${temp_cert_file}" >> "${ca_cert_file}"
      extracted_count=$((extracted_count + 1))
      rm -f "${temp_cert_file}"
    else
      log::info "✗ Could not extract certificate chain from console route"
    fi
  fi

  # Verify we got at least one certificate source
  if [[ "${extracted_count}" -eq 0 ]]; then
    log::error "Failed to extract certificates from any source"
    return 1
  fi

  log::success "Successfully merged certificates from ${extracted_count} source(s)"

  # Verify the extracted certificate(s) are valid
  if command -v openssl &> /dev/null; then
    # Count how many certificates are in the file
    local cert_count
    cert_count=$(grep -c "BEGIN CERTIFICATE" "${ca_cert_file}" 2> /dev/null || echo "0")

    if [[ "${cert_count}" -eq 0 ]]; then
      log::error "No valid certificates found in extracted file"
      return 1
    fi

    log::info "Found ${cert_count} certificate(s) in chain"

    # Validate the first certificate (openssl x509 reads the first cert by default)
    if ! openssl x509 -in "${ca_cert_file}" -text -noout > /dev/null 2>&1; then
      log::error "Certificate validation failed"
      return 1
    fi

    # Log details of the first certificate for debugging
    local cert_subject cert_issuer
    cert_subject=$(openssl x509 -in "${ca_cert_file}" -noout -subject 2> /dev/null | sed 's/subject=//')
    cert_issuer=$(openssl x509 -in "${ca_cert_file}" -noout -issuer 2> /dev/null | sed 's/issuer=//')
    log::info "First certificate - Subject: ${cert_subject}"
    log::info "First certificate - Issuer: ${cert_issuer}"

    log::success "Certificate validation passed"
  fi

  # Export NODE_EXTRA_CA_CERTS so Node.js (and Playwright) trusts this CA
  export NODE_EXTRA_CA_CERTS="${ca_cert_file}"
  log::success "Set NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS}"

  return 0
}

# Verify that the OpenShift cluster has FIPS mode enabled
# Returns:
#   0 - FIPS is enabled
#   1 - FIPS is not enabled or cannot be determined
verify_cluster_fips_enabled() {
  log::info "Verifying OpenShift cluster FIPS configuration..."

  local install_config
  install_config=$(oc get cm cluster-config-v1 -n kube-system -o jsonpath='{.data.install-config}' 2> /dev/null)

  if [[ -z "${install_config}" ]]; then
    log::error "Failed to retrieve cluster install-config from kube-system/cluster-config-v1"
    return 1
  fi

  if echo "${install_config}" | grep -q "fips: true"; then
    log::success "✓ Cluster FIPS mode: ENABLED"
    return 0
  else
    log::error "✗ Cluster FIPS mode: DISABLED (expected 'fips: true' in install-config)"
    log::info "Install config excerpt:"
    echo "${install_config}" | grep -A2 -B2 "fips" || echo "${install_config}" | head -10
    return 1
  fi
}

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"

  # Verify cluster FIPS mode is enabled
  verify_cluster_fips_enabled || {
    log::error "Cluster FIPS verification failed - this job requires a FIPS-enabled cluster"
    return 1
  }

  # Configure OpenShift CA certificate for Playwright
  configure_openshift_ca_for_playwright || {
    log::warn "Failed to configure OpenShift CA, tests may fail with certificate errors"
  }

  # Add extracted CA to system trust store so Chromium browser picks it up
  if [[ -n "${NODE_EXTRA_CA_CERTS}" && -f "${NODE_EXTRA_CA_CERTS}" ]]; then
    log::info "Adding OpenShift CA to system trust store for Chromium..."
    log::info "Checking permissions on /usr/local/share/ca-certificates/..."
    ls -la /usr/local/share/ca-certificates/
    log::info "Current user: $(whoami)"
    id
    cp "${NODE_EXTRA_CA_CERTS}" /usr/local/share/ca-certificates/openshift-ca-bundle.crt
    update-ca-certificates
    log::success "System CA trust store updated"
  fi

  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_FIPS}" "${url}"
}
