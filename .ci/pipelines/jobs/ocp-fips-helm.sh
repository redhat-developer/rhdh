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

run_standard_deployment_tests() {
  local url="https://${RELEASE_NAME}-developer-hub-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SHOWCASE_FIPS}" "${url}"
}
