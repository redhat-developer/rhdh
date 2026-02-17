#!/usr/bin/env bash

# Module: namespace
# Description: Kubernetes namespace lifecycle management utilities
# Dependencies: oc, kubectl, lib/log.sh

# Prevent re-sourcing
if [[ -n "${NAMESPACE_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly NAMESPACE_LIB_SOURCED=1

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# ==============================================================================
# Secret Management
# ==============================================================================

# Function: namespace::create_dockerconfigjson_secret
# Description: Creates a dockerconfigjson secret in the specified namespace
# Arguments:
#   $1 - namespace: The namespace to create the secret in
#   $2 - secret_name: Name of the secret to create
#   $3 - dockerconfigjson_value: Base64-encoded dockerconfigjson value
# Returns:
#   0 - Success
#   1 - Failure
namespace::create_dockerconfigjson_secret() {
  local namespace=$1
  local secret_name=$2
  local dockerconfigjson_value=$3
  log::info "Creating dockerconfigjson secret $secret_name in namespace $namespace"
  kubectl apply -n "$namespace" -f - << EOD
apiVersion: v1
kind: Secret
metadata:
  name: $secret_name
data:
  .dockerconfigjson: $dockerconfigjson_value
type: kubernetes.io/dockerconfigjson
EOD
  return $?
}

# Function: namespace::add_pull_secret_to_sa
# Description: Adds an image pull secret to the default service account
# Arguments:
#   $1 - namespace: The namespace containing the service account
#   $2 - secret_name: Name of the pull secret to add
# Returns:
#   0 - Success
#   1 - Failure
namespace::add_pull_secret_to_sa() {
  local namespace=$1
  local secret_name=$2
  log::info "Adding image pull secret $secret_name to default service account"
  kubectl -n "${namespace}" patch serviceaccount default -p "{\"imagePullSecrets\": [{\"name\": \"${secret_name}\"}]}"
  return $?
}

# Function: namespace::setup_image_pull_secret
# Description: Creates a pull secret and adds it to the default service account
# Arguments:
#   $1 - namespace: The namespace to configure
#   $2 - secret_name: Name of the pull secret
#   $3 - dockerconfigjson_value: Base64-encoded dockerconfigjson value
# Returns:
#   0 - Success
#   1 - Failure
namespace::setup_image_pull_secret() {
  local namespace=$1
  local secret_name=$2
  local dockerconfigjson_value=$3
  log::info "Creating $secret_name secret in $namespace namespace"
  namespace::create_dockerconfigjson_secret "$namespace" "$secret_name" "$dockerconfigjson_value"
  namespace::add_pull_secret_to_sa "$namespace" "$secret_name"
  return $?
}

# ==============================================================================
# Namespace Lifecycle
# ==============================================================================

# Function: namespace::configure
# Description: Deletes and recreates a namespace, then sets it as current context
# Arguments:
#   $1 - project: The namespace/project name
# Returns:
#   0 - Success
#   Exits on failure
namespace::configure() {
  local project=$1
  log::warn "Deleting and recreating namespace: $project"
  namespace::delete "$project"

  if ! oc create namespace "${project}"; then
    log::error "Error: Failed to create namespace ${project}" >&2
    exit 1
  fi
  if ! oc config set-context --current --namespace="${project}"; then
    log::error "Error: Failed to set context for namespace ${project}" >&2
    exit 1
  fi

  echo "Namespace ${project} is ready."
  return 0
}

# Function: namespace::delete
# Description: Deletes a namespace, handling stuck terminating state
# Arguments:
#   $1 - project: The namespace/project name to delete
# Returns:
#   0 - Success (or namespace doesn't exist)
namespace::delete() {
  local project=$1
  if oc get namespace "$project" > /dev/null 2>&1; then
    log::warn "Namespace ${project} exists. Attempting to delete..."

    # Remove blocking finalizers
    # namespace::remove_finalizers "$project"

    # Attempt to delete the namespace
    oc delete namespace "$project" --grace-period=0 --force || true

    # Check if namespace is still stuck in 'Terminating' and force removal if necessary
    if oc get namespace "$project" -o jsonpath='{.status.phase}' | grep -q 'Terminating'; then
      log::warn "Namespace ${project} is stuck in Terminating. Forcing deletion..."
      namespace::force_delete "$project"
    fi
  fi
  return 0
}

# Function: namespace::remove_finalizers
# Description: Removes finalizers from resources blocking namespace deletion
# Arguments:
#   $1 - project: The namespace/project name
# Returns:
#   0 - Success
namespace::remove_finalizers() {
  local project=$1
  echo "Removing finalizers from resources in namespace ${project} that are blocking deletion."

  # Remove finalizers from stuck PipelineRuns and TaskRuns
  for resource_type in "pipelineruns.tekton.dev" "taskruns.tekton.dev"; do
    for resource in $(oc get "$resource_type" -n "$project" -o name); do
      oc patch "$resource" -n "$project" --type='merge' -p '{"metadata":{"finalizers":[]}}' || true
      echo "Removed finalizers from $resource in $project."
    done
  done

  # Check and remove specific finalizers stuck on 'chains.tekton.dev' resources
  for chain_resource in $(oc get pipelineruns.tekton.dev,taskruns.tekton.dev -n "$project" -o name); do
    oc patch "$chain_resource" -n "$project" --type='json' -p='[{"op": "remove", "path": "/metadata/finalizers"}]' || true
    echo "Removed Tekton finalizers from $chain_resource in $project."
  done
  return 0
}

# Function: namespace::force_delete
# Description: Forcibly deletes a namespace stuck in Terminating status
# Arguments:
#   $1 - project: The namespace/project name
#   $2 - timeout_seconds: Timeout in seconds (default: 120)
# Returns:
#   0 - Success
#   1 - Timeout
namespace::force_delete() {
  local project=$1
  echo "Forcefully deleting namespace ${project}."
  oc get namespace "$project" -o json | jq '.spec = {"finalizers":[]}' | oc replace --raw "/api/v1/namespaces/$project/finalize" -f -

  local elapsed=0
  local sleep_interval=2
  local timeout_seconds=${2:-120}

  while oc get namespace "$project" &> /dev/null; do
    if [[ $elapsed -ge $timeout_seconds ]]; then
      log::warn "Timeout: Namespace '${project}' was not deleted within $timeout_seconds seconds." >&2
      return 1
    fi
    sleep $sleep_interval
    elapsed=$((elapsed + sleep_interval))
  done

  log::success "Namespace '${project}' successfully deleted."
  return 0
}
