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

  fips_configure_custom_ca_ingress

  cluster_setup_ocp_helm

  fips_deployment "${PW_PROJECT_SHOWCASE_FIPS}"

  deploy_test_backstage_customization_provider "${NAME_SPACE}"

  run_standard_deployment_tests
}

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

  # Merge base values with the FIPS environment overrides.
  helm::merge_values "overwrite" \
    "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" \
    "${fips_diff_value_file}" \
    "${fips_merged_value_file}"

  common::save_artifact "${artifacts_subdir}" "${fips_merged_value_file}" || true

  log::info "Deploying FIPS image from repository: ${IMAGE_REGISTRY}/${IMAGE_REPO}, TAG_NAME: ${TAG_NAME}, in NAME_SPACE: ${NAME_SPACE}"
  # shellcheck disable=SC2046
  helm upgrade -i "${RELEASE_NAME}" -n "${NAME_SPACE}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${fips_merged_value_file}" \
    --set openshift.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(helm::get_image_params)
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

  # Setup Chromium certificate store for Playwright
  fips_setup_chromium_cert_store || {
    log::error "Failed to setup Chromium certificate store"
    return 1
  }

  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_FIPS}" "${url}"
}

# Setup Chromium NSS certificate database for Playwright
# This function configures the Chromium certificate store used by Playwright
# to trust the custom root CA certificate.
#
# Required environment variables:
#   FIPS_ROOT_CA_CERT - Base64-encoded root CA certificate (PEM format)
#
# Returns:
#   0 - Success
#   1 - Failure (missing vars, certutil not found, or setup failed)
fips_setup_chromium_cert_store() {
  log::info "Setting up Chromium certificate store for Playwright..."

  # Verify required environment variable
  if [[ -z "${FIPS_ROOT_CA_CERT:-}" ]]; then
    log::error "FIPS_ROOT_CA_CERT is not set - cannot setup Chromium cert store"
    return 1
  fi

  # Check if certutil is available
  if ! command -v certutil &> /dev/null; then
    log::error "certutil command not found - required for NSS database setup"
    return 1
  fi

  local nss_db_dir="${HOME}/.pki/nssdb"
  local root_ca_file="${HOME}/.pki/rootCA.crt"

  # Create NSS database directory
  log::info "Creating NSS database directory: ${nss_db_dir}"
  mkdir -p "${nss_db_dir}"

  # Initialize NSS database (without sql: prefix for -N)
  log::info "Initializing NSS database..."
  if ! certutil -N -d "${nss_db_dir}" --empty-password; then
    log::error "Failed to initialize NSS database"
    return 1
  fi

  log::success "✓ NSS database initialized"

  # Write root CA certificate to file
  log::info "Writing root CA certificate to ${root_ca_file}"
  if ! echo "${FIPS_ROOT_CA_CERT}" | base64 -d > "${root_ca_file}"; then
    log::error "Failed to decode and write root CA certificate"
    return 1
  fi

  # Trust the custom CA in the Node.js process running Playwright TLS tests.
  export NODE_EXTRA_CA_CERTS="${root_ca_file}"

  # Add root CA certificate to NSS database (WITH sql: prefix for -A)
  log::info "Adding root CA certificate to NSS database..."
  if ! certutil -A -d "sql:${nss_db_dir}" -t "C,," -n "FIPS Root CA" -i "${root_ca_file}"; then
    log::error "Failed to add root CA certificate to NSS database"
    return 1
  fi

  log::success "✓ Root CA certificate added to NSS database"

  # Verify certificate was added
  log::info "Verifying certificate installation..."
  if ! certutil -L -d "sql:${nss_db_dir}" | grep -q "FIPS Root CA"; then
    log::error "Certificate verification failed - 'FIPS Root CA' not found in database"
    return 1
  fi

  log::success "✓ Certificate verified in NSS database"

  # List all certificates for debugging
  log::info "Certificates in NSS database:"
  certutil -L -d "sql:${nss_db_dir}"

  log::success "Chromium certificate store setup completed successfully"
  return 0
}

# Configure custom CA certificate for OpenShift Ingress Controller
# This function generates a wildcard certificate signed by a custom root CA
# and patches the default IngressController to use it.
#
# Required environment variables:
#   FIPS_ROOT_CA_CERT - Base64-encoded root CA certificate (PEM format)
#   FIPS_ROOT_CA_KEY  - Base64-encoded root CA private key (PEM format)
#   K8S_CLUSTER_ROUTER_BASE - Cluster router base domain (e.g., apps.example.com)
#
# Returns:
#   0 - Success
#   1 - Failure (missing vars, cert generation failed, or patch failed)
fips_configure_custom_ca_ingress() {
  log::info "Configuring custom CA certificate for OpenShift Ingress..."

  # Verify required environment variables
  if [[ -z "${FIPS_ROOT_CA_CERT:-}" ]] || [[ -z "${FIPS_ROOT_CA_KEY:-}" ]]; then
    log::warning "FIPS_ROOT_CA_CERT or FIPS_ROOT_CA_KEY not set - skipping custom CA configuration"
    return 0
  fi

  if [[ -z "${K8S_CLUSTER_ROUTER_BASE:-}" ]]; then
    log::error "K8S_CLUSTER_ROUTER_BASE is not set - cannot determine cluster domain"
    return 1
  fi

  local wildcard_domain="*.${K8S_CLUSTER_ROUTER_BASE}"
  local secret_name="custom-certs-default"
  local ingress_namespace="openshift-ingress"
  local tmpdir
  tmpdir=$(mktemp -d)

  # Ensure cleanup on exit
  trap 'rm -rf "${tmpdir}"' EXIT

  log::info "Generating wildcard certificate for domain: ${wildcard_domain}"

  # Write CA cert and key to temporary files
  echo "${FIPS_ROOT_CA_CERT}" | base64 -d > "${tmpdir}/rootCA.crt"
  echo "${FIPS_ROOT_CA_KEY}" | base64 -d > "${tmpdir}/rootCA.key"

  # Generate ECDSA P-256 key for wildcard certificate (FIPS-compliant)
  openssl ecparam -name prime256v1 -genkey -noout -out "${tmpdir}/wildcard.key"

  # Generate CSR
  openssl req -new -key "${tmpdir}/wildcard.key" \
    -out "${tmpdir}/wildcard.csr" \
    -subj "/O=CI-FIPS-Testing/CN=FIPS CI Ingress"

  # Create extensions file for v3 certificate
  cat > "${tmpdir}/wildcard_ext.cnf" << EOF
[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = issuer
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = ${wildcard_domain}
DNS.2 = ${K8S_CLUSTER_ROUTER_BASE}
EOF

  # Sign the CSR with the Root CA
  openssl x509 -req -in "${tmpdir}/wildcard.csr" \
    -CA "${tmpdir}/rootCA.crt" -CAkey "${tmpdir}/rootCA.key" -CAcreateserial \
    -out "${tmpdir}/wildcard.crt" -days 30 -sha256 \
    -extfile "${tmpdir}/wildcard_ext.cnf" -extensions v3_req

  if [[ ! -f "${tmpdir}/wildcard.crt" ]]; then
    log::error "Failed to generate wildcard certificate"
    return 1
  fi

  log::success "✓ Wildcard certificate generated successfully"

  # Verify the certificate
  local cert_subject
  cert_subject=$(openssl x509 -in "${tmpdir}/wildcard.crt" -noout -subject)
  log::info "Certificate subject: ${cert_subject}"

  # Create TLS secret in openshift-ingress namespace
  log::info "Creating TLS secret '${secret_name}' in namespace '${ingress_namespace}'"

  # Delete existing secret if it exists
  oc delete secret "${secret_name}" -n "${ingress_namespace}" --ignore-not-found=true

  # Create new secret
  oc create secret tls "${secret_name}" \
    -n "${ingress_namespace}" \
    --cert="${tmpdir}/wildcard.crt" \
    --key="${tmpdir}/wildcard.key"

  if [[ $? -ne 0 ]]; then
    log::error "Failed to create TLS secret in ${ingress_namespace}"
    return 1
  fi

  log::success "✓ TLS secret '${secret_name}' created in namespace '${ingress_namespace}'"

  # Clean up temporary files immediately
  rm -rf "${tmpdir}"
  trap - EXIT

  # Patch the default IngressController to use the custom certificate
  log::info "Patching default IngressController to use custom certificate..."

  oc patch ingresscontroller.operator default \
    -n openshift-ingress-operator \
    --type=merge \
    -p "{\"spec\":{\"defaultCertificate\":{\"name\":\"${secret_name}\"}}}"

  if [[ $? -ne 0 ]]; then
    log::error "Failed to patch IngressController"
    return 1
  fi

  log::success "✓ IngressController patched successfully"

  # Wait for the router deployment to roll out with new certificates
  log::info "Waiting for router pods to restart with new certificates..."

  if ! oc rollout status deployment/router-default -n "${ingress_namespace}" --timeout=5m; then
    log::warning "Router rollout did not complete within timeout - continuing anyway"
  else
    log::success "✓ Router pods restarted successfully"
  fi

  log::success "Custom CA ingress configuration completed successfully"
  return 0
}
