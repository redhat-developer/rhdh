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

  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_FIPS}" "${url}"
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
