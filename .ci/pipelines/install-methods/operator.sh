#!/bin/bash

if [[ -n "${OPERATOR_INSTALL_METHODS_SOURCED:-}" ]]; then
  return 0
fi
readonly OPERATOR_INSTALL_METHODS_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh

install_rhdh_operator() {
  local namespace=$1
  local max_attempts=$2

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

  if [[ "$RELEASE_VERSION" == "next" ]]; then
    log::info "Installing RHDH operator with '--next' flag"
    if ! common::retry "$max_attempts" 10 bash -x /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh; then
      log::error "Failed install RHDH Operator after ${max_attempts} attempts."
      return 1
    fi
  else
    log::info "Installing RHDH operator with '-v $RELEASE_VERSION' flag"
    if ! common::retry "$max_attempts" 10 bash -x /tmp/install-rhdh-catalog-source.sh -v "$RELEASE_VERSION" --install-operator rhdh; then
      log::error "Failed install RHDH Operator after ${max_attempts} attempts."
      return 1
    fi
  fi

  override_operator_backstage_image "$namespace"
}

# The operator bundle CSV pins RELATED_IMAGE_backstage to the hub image digest
# captured when the bundle was built, which can lag the floating tag by weeks.
# The operator applies that env to the install-dynamic-plugins init container
# even when the Backstage CR deployment.patch overrides the main container, so
# tests would exercise a stale installer image. Point the CSV at the image
# under test; OLM propagates the change to the operator deployment.
override_operator_backstage_image() {
  local namespace=$1
  local image="${IMAGE_REGISTRY}/${IMAGE_REPO}:${TAG_NAME}"
  local csv_name

  # OLM v1 installs (install-rhdh-catalog-source.sh auto-detects it and uses a
  # ClusterExtension) have no CSV to patch.
  if oc get clusterextension rhdh &> /dev/null; then
    log::info "RHDH installed via OLM v1 ClusterExtension; skipping CSV backstage image override"
    return 0
  fi

  # install-rhdh-catalog-source.sh returns right after creating the
  # Subscription, so the CSV may not exist yet — wait for it.
  if ! common::poll_until \
    "oc get csv -n '$namespace' -o name 2> /dev/null | grep -qE '/rhdh(-operator)?\\.'" \
    30 10 "RHDH CSV present in namespace '$namespace'"; then
    log::warn "No RHDH CSV appeared in namespace '$namespace'; skipping backstage image override"
    return 0
  fi
  # `|| true` guards: the script runs with `set -o errexit`, and an empty grep
  # or a missing resource must fall through to the guards, not abort.
  csv_name=$(oc get csv -n "$namespace" -o name 2> /dev/null | grep -E '/rhdh(-operator)?\.' | head -1 || true)
  if [[ -z "$csv_name" ]]; then
    log::warn "No RHDH CSV found in namespace '$namespace'; skipping backstage image override"
    return 0
  fi

  local csv_json
  csv_json=$(oc get "$csv_name" -n "$namespace" -o json 2> /dev/null || true)
  if [[ -z "$csv_json" ]]; then
    log::error "Failed to read ${csv_name} in namespace '$namespace'"
    return 1
  fi

  local patch
  patch=$(jq --arg img "$image" -c '
    [ .spec.install.spec.deployments as $ds
      | range(0; $ds | length) as $d
      | $ds[$d].spec.template.spec.containers as $cs
      | range(0; $cs | length) as $c
      | ($cs[$c].env // []) as $es
      | range(0; $es | length) as $e
      | select($es[$e].name == "RELATED_IMAGE_backstage")
      | { op: "replace",
          path: "/spec/install/spec/deployments/\($d)/spec/template/spec/containers/\($c)/env/\($e)/value",
          value: $img } ]' <<< "$csv_json" || true)
  if [[ -z "$patch" || "$patch" == "[]" ]]; then
    log::warn "RELATED_IMAGE_backstage not found in ${csv_name}; skipping backstage image override"
    return 0
  fi

  log::info "Overriding RELATED_IMAGE_backstage in ${csv_name} with '${image}'"
  if ! oc patch "$csv_name" -n "$namespace" --type=json -p "$patch"; then
    log::error "Failed to patch ${csv_name} with backstage image override"
    return 1
  fi

  # OLM reconciles the operator deployment from the CSV; wait for the new env
  # to land and for the operator pod to restart with it.
  local operator_deployment
  operator_deployment=$(oc get deployment -n "$namespace" -l control-plane=controller-manager -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
  if [[ -z "$operator_deployment" ]]; then
    log::warn "No operator deployment found in namespace '$namespace'; not waiting for image override rollout"
    return 0
  fi
  if ! common::poll_until \
    "oc get deployment '$operator_deployment' -n '$namespace' -o json | jq -e --arg img '$image' '[.spec.template.spec.containers[].env // [] | .[] | select(.name == \"RELATED_IMAGE_backstage\")] | any(.value == \$img)'" \
    30 5 "Operator deployment picked up backstage image override"; then
    log::error "Operator deployment did not pick up the backstage image override"
    return 1
  fi
  if ! oc rollout status "deployment/${operator_deployment}" -n "$namespace" --timeout=300s; then
    log::error "Operator deployment '${operator_deployment}' did not finish rolling out after the backstage image override"
    return 1
  fi
}

prepare_operator() {
  local retry_operator_installation="${1:-1}"
  namespace::configure "${OPERATOR_MANAGER}"
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"

  # Wait for Backstage CRD to be available after operator installation
  k8s_wait::crd "backstages.rhdh.redhat.com" 300 10 || return 1
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
