#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_ocp_helm_upgrade() {
  export NAME_SPACE="${NAME_SPACE:-showcase-upgrade-nightly}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-${NAME_SPACE}-postgres-external-db}"
  export DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-${RELEASE_NAME}-developer-hub}"
  export QUAY_REPO_BASE="${QUAY_REPO_BASE:-rhdh/rhdh-hub-rhel9}"

  # Dynamically determine the previous release version and chart version
  previous_release_version=$(common::get_previous_release_version "$CHART_MAJOR_VERSION")
  if [[ -z "$previous_release_version" ]]; then
    log::error "Failed to determine latest release version. Exiting."
    save_overall_result 1
    exit 1
  fi
  CHART_VERSION_BASE=$(helm::get_chart_version "$previous_release_version")
  if [[ -z "$CHART_VERSION_BASE" ]]; then
    log::error "Failed to determine correct chart version for $previous_release_version. Exiting."
    save_overall_result 1
    exit 1
  fi
  export CHART_VERSION_BASE
  log::info "Using previous release version: ${previous_release_version} and chart version: ${CHART_VERSION_BASE}"
  export TAG_NAME_BASE=$previous_release_version

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm

  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  initiate_upgrade_base_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"
  deploy_orchestrator_workflows "${NAME_SPACE}"
  initiate_upgrade_deployments "${RELEASE_NAME}" "${NAME_SPACE}" "${url}"

  testing::check_upgrade_and_test "${DEPLOYMENT_NAME}" "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_UPGRADE}" "${url}"
}
