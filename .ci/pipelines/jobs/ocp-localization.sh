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

handle_ocp_localization() {
  export NAME_SPACE="${NAME_SPACE:-showcase-localization-nightly}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  cluster_setup_ocp_helm
  base_deployment "${PW_PROJECT_SHOWCASE}"
  deploy_test_backstage_customization_provider "${NAME_SPACE}"

  run_localization_tests
}

run_localization_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  local locales=("DE" "ES" "FR" "IT" "JA")

  log::section "Running localization tests"
  for locale in "${locales[@]}"; do
    local project_var="PW_PROJECT_SHOWCASE_LOCALIZATION_${locale}"
    local project="${!project_var}"
    log::info "Running localization test for ${locale} (project: ${project})"
    testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${project}" "${url}" "" "" "${project}"
  done
}
