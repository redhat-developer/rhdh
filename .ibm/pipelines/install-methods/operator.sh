#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

install_rhdh_operator() {
  local namespace=$1
  local max_attempts=$2

  configure_namespace "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT}" == "false" ]]; then
    setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
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
  configure_namespace "${OPERATOR_MANAGER}"
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

  # Wait for the operator to create the Backstage deployment
  log::info "Waiting for operator to create Backstage deployment..."
  local max_wait=60 # Wait up to 5 minutes for deployment to be created
  local waited=0
  while [[ $waited -lt $max_wait ]]; do
    if oc get deployment -n "$namespace" --no-headers 2> /dev/null | grep -q "backstage-"; then
      log::success "Backstage deployment created by operator"
      break
    fi
    log::debug "Waiting for deployment to be created... ($waited/$max_wait checks)"
    sleep 5
    waited=$((waited + 1))
  done

  if [[ $waited -eq $max_wait ]]; then
    log::error "Backstage deployment not created after ${max_wait} checks (5 minutes)"
    log::info "Checking Backstage CR status for errors..."
    oc get backstage rhdh -n "$namespace" -o yaml | grep -A 20 "status:" || true
    log::info "Checking operator logs..."
    oc logs -n "${OPERATOR_MANAGER:-rhdh-operator}" -l control-plane=controller-manager --tail=50 || true
    return 1
  fi

  # Wait for the operator to create the database resource
  # The operator can create either:
  # 1. PostgresCluster (if Crunchy operator is used)
  # 2. StatefulSet (built-in postgres)
  log::info "Waiting for operator to create database resource..."
  local psql_wait=60 # Wait up to 5 minutes for database to be created
  local psql_waited=0

  while [[ $psql_waited -lt $psql_wait ]]; do
    # Check for PostgresCluster (Crunchy-based)
    if oc get postgrescluster -n "$namespace" --no-headers 2> /dev/null | grep -q "backstage-psql"; then
      log::success "PostgresCluster 'backstage-psql' created by operator (Crunchy-based)"
      return 0
    fi

    # Check for StatefulSet (built-in postgres)
    if oc get statefulset -n "$namespace" --no-headers 2> /dev/null | grep -q "backstage-psql"; then
      log::success "StatefulSet 'backstage-psql-rhdh' created by operator (built-in postgres)"
      return 0
    fi

    log::debug "Waiting for database resource to be created... ($psql_waited/$psql_wait checks)"
    sleep 5
    psql_waited=$((psql_waited + 1))
  done

  log::error "Database resource not created after ${psql_wait} checks"
  log::info "Checking Backstage CR status for errors..."
  oc get backstage rhdh -n "$namespace" -o yaml | grep -A 20 "status:" || true
  log::info "Checking operator logs..."
  oc logs -n "${OPERATOR_MANAGER:-rhdh-operator}" -l control-plane=controller-manager --tail=50 || true
  log::info "Checking for StatefulSet..."
  oc get statefulset -n "$namespace" || true
  log::info "Checking for PostgresCluster..."
  oc get postgrescluster -n "$namespace" 2> /dev/null || echo "No PostgresCluster CRD or resources found"
  return 1
}

delete_rhdh_operator() {
  kubectl delete namespace "$OPERATOR_MANAGER" --ignore-not-found
}
