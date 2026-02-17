#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ibm/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ibm/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh

handle_ocp_pull() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

  log::info "Configuring namespace: ${NAME_SPACE}"
  common::oc_login
  log::info "OCP version: $(oc version)"

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE
  cluster_setup_ocp_helm
  initiate_deployments
  deploy_test_backstage_customization_provider "${NAME_SPACE}"
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE}" "${url}"
  local rbac_url="https://${RELEASE_NAME_RBAC}-developer-hub-${NAME_SPACE_RBAC}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME_RBAC}" "${NAME_SPACE_RBAC}" "${PW_PROJECT_SHOWCASE_RBAC}" "${rbac_url}"
}
