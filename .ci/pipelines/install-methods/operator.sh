#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh

# Run install-rhdh-catalog-source.sh with visible logs (common::retry swallows stdout/stderr).
# Forces OLM v0: auto-detect can pick OLM v1 (ClusterExtension) which returns success without
# waiting for the operator CSV/CRDs, leaving Backstage CRD missing.
_install_rhdh_operator_once() {
  local -a install_args=()

  if [[ "${RELEASE_VERSION}" == "next" ]]; then
    log::info "Installing RHDH operator with '--next --olm-version v0'"
    install_args=(--next --olm-version v0 --install-operator rhdh)
  else
    log::info "Installing RHDH operator with '-v ${RELEASE_VERSION} --olm-version v0'"
    install_args=(-v "${RELEASE_VERSION}" --olm-version v0 --install-operator rhdh)
  fi

  # Stream script output to the CI log; do not capture (common::retry hides failures).
  bash -x /tmp/install-rhdh-catalog-source.sh "${install_args[@]}"
}

install_rhdh_operator() {
  local namespace=$1
  local max_attempts=$2
  local attempt=1

  namespace::configure "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
    namespace::setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
  fi
  # Note: The operator is always installed from quay.io/rhdh/iib regardless of IMAGE_REGISTRY.
  # The install-rhdh-catalog-source.sh script from the rhdh-operator repo has quay.io hardcoded
  # as the IIB image source. IMAGE_REGISTRY only affects the RHDH application image, not the operator.
  if [[ "${IMAGE_REGISTRY}" != "quay.io" ]]; then
    log::warn "IMAGE_REGISTRY is set to '${IMAGE_REGISTRY}', but the RHDH operator is always installed from quay.io/rhdh/iib"
  fi

  rm -f /tmp/install-rhdh-catalog-source.sh
  if ! curl -fL -o /tmp/install-rhdh-catalog-source.sh "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh"; then
    log::error "Failed to download install-rhdh-catalog-source.sh from branch ${RELEASE_BRANCH_NAME}"
    return 1
  fi
  chmod +x /tmp/install-rhdh-catalog-source.sh

  while ((attempt <= max_attempts)); do
    log::info "Operator install script attempt ${attempt}/${max_attempts}"
    if _install_rhdh_operator_once; then
      log::success "Operator install script succeeded on attempt ${attempt}"
      return 0
    fi
    log::warn "Operator install script failed on attempt ${attempt}/${max_attempts}"
    if ((attempt < max_attempts)); then
      sleep 10
    fi
    attempt=$((attempt + 1))
  done

  log::error "Failed install RHDH Operator after ${max_attempts} attempts."
  return 1
}

# Dump OLM / operator-manager state when Backstage CRD registration fails.
_operator_olm_debug_info() {
  local ns="${OPERATOR_MANAGER:-rhdh-operator}"
  log::info "OLM/operator diagnostics in namespace: ${ns}"
  oc get operatorgroup,csv,sub,ip,deploy,pods -n "${ns}" -o wide 2>&1 || true
  log::info "CatalogSource in openshift-marketplace / olm:"
  oc get catalogsource -n openshift-marketplace -o wide 2>&1 || true
  oc get catalogsource -n olm -o wide 2>&1 || true
  log::info "ClusterExtension / ClusterCatalog (OLM v1), if present:"
  oc get clusterextension,clustercatalog 2>&1 || true
  log::info "Backstage CRD:"
  oc get crd backstages.rhdh.redhat.com -o yaml 2>&1 | head -40 || true
  oc logs -n "${ns}" -l control-plane=controller-manager --tail=100 2>&1 || true
  oc get events -n "${ns}" --sort-by='.lastTimestamp' 2>&1 | tail -40 || true
}

# Install the RHDH operator and wait for the Backstage CRD.
# Retries the *entire* cycle (namespace recreate → install → CRD wait) up to N times.
# Args:
#   $1 - max full-cycle attempts (default: 1)
prepare_operator() {
  local max_cycles=${1:-1}
  local attempt=1

  while ((attempt <= max_cycles)); do
    log::info "Preparing RHDH operator (attempt ${attempt}/${max_cycles})"
    # install_rhdh_operator calls namespace::configure — avoid a second wipe here.
    if ! install_rhdh_operator "${OPERATOR_MANAGER}" 1; then
      log::error "Operator install script failed on attempt ${attempt}/${max_cycles}"
      _operator_olm_debug_info
      if ((attempt < max_cycles)); then
        attempt=$((attempt + 1))
        continue
      fi
      return 1
    fi

    # Subscription should exist quickly; fail fast with diagnostics if the script
    # returned 0 without creating OLM v0 resources.
    if ! oc get subscription rhdh -n "${OPERATOR_MANAGER}" &> /dev/null; then
      log::error "Subscription/rhdh missing in ${OPERATOR_MANAGER} after install script success"
      _operator_olm_debug_info
      if ((attempt < max_cycles)); then
        attempt=$((attempt + 1))
        continue
      fi
      return 1
    fi

    if k8s_wait::crd "backstages.rhdh.redhat.com" 300 10; then
      log::info "Backstage CRD available after operator prepare attempt ${attempt}"
      return 0
    fi

    log::error "Backstage CRD not available after install attempt ${attempt}/${max_cycles}"
    _operator_olm_debug_info
    attempt=$((attempt + 1))
  done

  log::error "Failed to prepare RHDH operator after ${max_cycles} full cycle(s)"
  return 1
}

# Waits for the Crunchy Data PostgreSQL Operator's PostgresCluster CRD to become available.
# Must be called after the Crunchy DB CRD is created and before RHDH is deployed
# with internal DB disabled and configured to use Crunchy DB as the external PostgreSQL database.
wait_for_crunchy_crd() {
  log::info "Verifying PostgresCluster CRD is available before deploying Backstage CR..."
  k8s_wait::crd "postgresclusters.postgres-operator.crunchydata.com" 60 5 || {
    log::error "PostgresCluster CRD not available - operator won't be able to create internal database"
    return 1
  }
}

deploy_rhdh_operator() {
  local namespace=$1
  local backstage_crd_path=$2
  local skip_db_wait=${3:-false}

  # Verify Backstage CRD is available
  k8s_wait::crd "backstages.rhdh.redhat.com" 60 5 || return 1

  rendered_yaml=$(envsubst < "$backstage_crd_path")
  if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
    # Dynamically inject CATALOG_INDEX_IMAGE environment variable if specified
    rendered_yaml=$(echo "$rendered_yaml" | yq eval '.spec.application.extraEnvs.envs += [{"name": "CATALOG_INDEX_IMAGE", "value": "'"$CATALOG_INDEX_IMAGE"'", "containers": ["install-dynamic-plugins"]}]' -)
  fi
  log::info "Applying Backstage CR from: $backstage_crd_path"
  log::debug "$rendered_yaml"
  echo "$rendered_yaml" | oc apply -f - -n "$namespace"

  # Wait for the operator to create the Backstage deployment (5 minutes max)
  if ! common::poll_until \
    "oc get deployment -n '$namespace' --no-headers 2>/dev/null | grep -q 'backstage-'" \
    60 5 "Backstage deployment created by operator"; then
    log::error "Backstage deployment not created after 5 minutes"
    _operator_debug_info "$namespace"
    return 1
  fi

  if [[ "$skip_db_wait" == "true" ]]; then
    log::info "Skipping database resource wait (enableLocalDb=false)"
    return 0
  fi

  # Wait for the operator to create the database resource (5 minutes max)
  # The operator can create either PostgresCluster (Crunchy) or StatefulSet (built-in)
  if ! common::poll_until \
    "oc get postgrescluster -n '$namespace' --no-headers 2>/dev/null | grep -q 'backstage-psql' || \
     oc get statefulset -n '$namespace' --no-headers 2>/dev/null | grep -q 'backstage-psql'" \
    60 5 "Database resource created by operator"; then
    log::error "Database resource not created after 5 minutes"
    _operator_debug_info "$namespace"
    return 1
  fi

  return 0
}

# Helper function to collect operator debug information
_operator_debug_info() {
  local namespace=$1
  log::info "Checking Backstage CR status for errors..."
  oc get backstage rhdh -n "$namespace" -o yaml | grep -A 20 "status:" || true
  log::info "Checking operator logs..."
  oc logs -n "${OPERATOR_MANAGER:-rhdh-operator}" -l control-plane=controller-manager --tail=50 || true
  log::info "Checking for StatefulSet..."
  oc get statefulset -n "$namespace" || true
  log::info "Checking for PostgresCluster..."
  oc get postgrescluster -n "$namespace" 2> /dev/null || echo "No PostgresCluster CRD or resources found"
}

delete_rhdh_operator() {
  kubectl delete namespace "$OPERATOR_MANAGER" --ignore-not-found
}
