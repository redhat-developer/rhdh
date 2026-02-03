#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

install_rhdh_operator() {
  local namespace=$1
  local max_attempts=$2

  namespace::configure "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
    namespace::setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
  fi
  # Make sure script is up to date
  rm -f /tmp/install-rhdh-catalog-source.sh
  curl -L "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh" > /tmp/install-rhdh-catalog-source.sh
  chmod +x /tmp/install-rhdh-catalog-source.sh

  if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
    log::info "Installing RHDH operator with '--next' flag"
    if ! common::retry "$max_attempts" 10 bash -x /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh; then
      log::error "Failed install RHDH Operator after ${max_attempts} attempts."
      return 1
    fi
  else
    local operator_version="${RELEASE_BRANCH_NAME#release-}"
    if [[ -z "$operator_version" ]]; then
      log::error "Failed to extract operator version from RELEASE_BRANCH_NAME: '$RELEASE_BRANCH_NAME'"
      return 1
    fi
    log::info "Installing RHDH operator with '-v $operator_version' flag"
    if ! common::retry "$max_attempts" 10 bash -x /tmp/install-rhdh-catalog-source.sh -v "$operator_version" --install-operator rhdh; then
      log::error "Failed install RHDH Operator after ${max_attempts} attempts."
      return 1
    fi
  fi
}

prepare_operator() {
  local retry_operator_installation="${1:-1}"
  namespace::configure "${OPERATOR_MANAGER}"
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"

  # Wait for Backstage CRD to be available after operator installation
  k8s_wait::crd "backstages.rhdh.redhat.com" 300 10 || return 1
}

deploy_rhdh_operator() {
  local namespace=$1
  local backstage_crd_path=$2

  # Ensure PostgresCluster CRD is available before deploying Backstage CR
  # This is critical because the operator will try to create a PostgresCluster resource
  log::info "Verifying PostgresCluster CRD is available before deploying Backstage CR..."
  k8s_wait::crd "postgresclusters.postgres-operator.crunchydata.com" 60 5 || {
    log::error "PostgresCluster CRD not available - operator won't be able to create internal database"
    return 1
  }

  # Verify Backstage CRD is also available
  k8s_wait::crd "backstages.rhdh.redhat.com" 60 5 || return 1

  rendered_yaml=$(envsubst < "$backstage_crd_path")
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
