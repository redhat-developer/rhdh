#!/bin/bash
#
# Job handler for re-running only the failed tests from a previous e2e-ocp-helm execution.
#
# This job:
# 1. Fetches JUnit results from the previous e2e-ocp-helm run
# 2. Parses which tests failed for each namespace (showcase, showcase-rbac)
# 3. Deploys only the namespaces that had failures
# 4. Runs only the tests that previously failed
#

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ibm/pipelines/playwright-projects.sh
source "${DIR}/playwright-projects.sh"
# shellcheck source=.ibm/pipelines/retest-failed-utils.sh
source "${DIR}/retest-failed-utils.sh"

#######################################
# Main handler for the rerun-failed-tests job
#######################################
handle_ocp_rerun_failed_tests() {
  export NAME_SPACE="${NAME_SPACE:-showcase}"
  export NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
  export NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"

  log::section "Rerun Failed Tests Job"

  # Validate required dependencies
  if ! validate_dependencies; then
    return 1
  fi

  # Get PR information
  get_pr_info

  if [[ -z "${PULL_NUMBER:-}" ]]; then
    log::error "PULL_NUMBER is not set. Cannot determine which PR to fetch results for."
    log::info "This job should only run in a PR context."
    return 1
  fi

  # Login to OpenShift cluster
  log::info "Logging into OpenShift cluster..."
  oc_login
  log::info "OCP version: $(oc version)"

  # Get cluster router base
  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  # Create temp directory for JUnit files
  local temp_dir="/tmp/rerun-failed-tests"
  rm -rf "${temp_dir}"
  mkdir -p "${temp_dir}"

  # Get previous build ID
  local build_id
  build_id=$(get_previous_failed_build_id "${REPO_OWNER}" "${REPO_NAME}" "${PULL_NUMBER}")

  if [[ -z "${build_id}" ]]; then
    log::warn "No previous build found for e2e-ocp-helm job."
    log::info "Nothing to rerun. Exiting with success."
    return 0
  fi

  log::info "Previous build ID: ${build_id}"

  # Fetch and parse JUnit results for each namespace
  local showcase_junit="${temp_dir}/showcase-junit.xml"
  local showcase_rbac_junit="${temp_dir}/showcase-rbac-junit.xml"

  local showcase_url
  showcase_url=$(build_previous_run_artifact_url "${REPO_OWNER}" "${REPO_NAME}" "${PULL_NUMBER}" \
    "${RERUN_TARGET_JOB}" "${build_id}" "${NAME_SPACE}")

  local showcase_rbac_url
  showcase_rbac_url=$(build_previous_run_artifact_url "${REPO_OWNER}" "${REPO_NAME}" "${PULL_NUMBER}" \
    "${RERUN_TARGET_JOB}" "${build_id}" "${NAME_SPACE_RBAC}")

  # Fetch JUnit results
  local has_showcase_results=false
  local has_rbac_results=false

  if fetch_previous_junit_results "${showcase_url}" "${showcase_junit}"; then
    has_showcase_results=true
  fi

  if fetch_previous_junit_results "${showcase_rbac_url}" "${showcase_rbac_junit}"; then
    has_rbac_results=true
  fi

  if [[ "${has_showcase_results}" == "false" && "${has_rbac_results}" == "false" ]]; then
    log::warn "Could not fetch JUnit results from previous run."
    log::info "The previous run may not have completed or artifacts may have expired."
    log::info "Nothing to rerun. Exiting with success."
    return 0
  fi

  # Parse failed tests for each namespace
  local -a showcase_failed_tests=()
  local -a rbac_failed_tests=()

  if [[ "${has_showcase_results}" == "true" ]]; then
    local showcase_failures
    showcase_failures=$(get_failed_test_count "${showcase_junit}")
    log::info "Showcase namespace: ${showcase_failures} failures"

    if [[ "${showcase_failures}" -gt 0 ]]; then
      mapfile -t showcase_failed_tests < <(parse_failed_tests_from_junit "${showcase_junit}")
      # Filter to only existing test files
      mapfile -t showcase_failed_tests < <(filter_existing_test_files "${showcase_failed_tests[@]}")
    fi
  fi

  if [[ "${has_rbac_results}" == "true" ]]; then
    local rbac_failures
    rbac_failures=$(get_failed_test_count "${showcase_rbac_junit}")
    log::info "Showcase-RBAC namespace: ${rbac_failures} failures"

    if [[ "${rbac_failures}" -gt 0 ]]; then
      mapfile -t rbac_failed_tests < <(parse_failed_tests_from_junit "${showcase_rbac_junit}")
      # Filter to only existing test files
      mapfile -t rbac_failed_tests < <(filter_existing_test_files "${rbac_failed_tests[@]}")
    fi
  fi

  # Check if there are any tests to rerun
  if [[ ${#showcase_failed_tests[@]} -eq 0 && ${#rbac_failed_tests[@]} -eq 0 ]]; then
    log::success "No failed tests found in previous run!"
    log::info "Either all tests passed or the failed test files no longer exist."
    return 0
  fi

  log::section "Tests to Rerun"
  log::info "Showcase failed tests: ${#showcase_failed_tests[@]}"
  log::info "RBAC failed tests: ${#rbac_failed_tests[@]}"

  # Setup cluster (operators, etc.) - needed for deployment
  cluster_setup_ocp_helm

  # Deploy and test based on which namespaces had failures
  local overall_result=0

  if [[ ${#showcase_failed_tests[@]} -gt 0 ]]; then
    log::section "Rerunning Showcase Failed Tests"
    deploy_and_retest_namespace \
      "${NAME_SPACE}" \
      "${RELEASE_NAME}" \
      "${PW_PROJECT_SHOWCASE}" \
      showcase_failed_tests[@] || overall_result=1
  fi

  if [[ ${#rbac_failed_tests[@]} -gt 0 ]]; then
    log::section "Rerunning RBAC Failed Tests"
    deploy_and_retest_namespace_rbac \
      "${NAME_SPACE_RBAC}" \
      "${RELEASE_NAME_RBAC}" \
      "${PW_PROJECT_SHOWCASE_RBAC}" \
      rbac_failed_tests[@] || overall_result=1
  fi

  # Cleanup temp directory
  rm -rf "${temp_dir}"

  # Report final result
  if [[ ${overall_result} -eq 0 ]]; then
    log::success "All rerun tests passed!"
  else
    log::error "Some rerun tests still failed."
    save_overall_result 1
  fi

  return ${overall_result}
}

#######################################
# Deploy showcase namespace and retest failed tests
# Arguments:
#   namespace: The namespace to deploy to
#   release_name: Helm release name
#   playwright_project: Playwright project name
#   failed_tests_ref: Name reference to array of failed test files
#######################################
deploy_and_retest_namespace() {
  local namespace="${1}"
  local release_name="${2}"
  local playwright_project="${3}"
  # shellcheck disable=SC2034  # nameref variable used via indirection
  local -n failed_tests="${4}"  # NOSONAR - nameref is used when passed to run_failed_tests_and_report

  log::info "Deploying to namespace: ${namespace}"

  # Configure namespace
  configure_namespace "${namespace}"
  deploy_redis_cache "${namespace}"

  cd "${DIR}"

  local rhdh_base_url="https://${release_name}-developer-hub-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${namespace}" "${rhdh_base_url}"

  log::info "Deploying image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}"

  # Use the same deployment logic as PR jobs (skip orchestrator)
  local merged_pr_value_file="/tmp/merged-values_showcase_PR.yaml"
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase_PR.yaml" "${merged_pr_value_file}"
  disable_orchestrator_plugins_in_values "${merged_pr_value_file}"

  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "${merged_pr_value_file}" "${ARTIFACT_DIR}/${namespace}/" || true

  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${merged_pr_value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)

  deploy_test_backstage_customization_provider "${namespace}"

  # Wait for deployment and run failed tests
  local url="https://${release_name}-developer-hub-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"

  if check_backstage_running "${release_name}" "${namespace}" "${url}"; then
    log::info "Backstage is running. Running failed tests..."
    run_failed_tests_and_report "${namespace}" "${playwright_project}" "${url}" failed_tests[@]
    local result=$?
    save_all_pod_logs "${namespace}"
    return ${result}
  else
    log::error "Backstage deployment failed in ${namespace}"
    save_all_pod_logs "${namespace}"
    return 1
  fi
}

#######################################
# Deploy showcase-rbac namespace and retest failed tests
# Arguments:
#   namespace: The namespace to deploy to
#   release_name: Helm release name
#   playwright_project: Playwright project name
#   failed_tests_ref: Name reference to array of failed test files
#######################################
deploy_and_retest_namespace_rbac() {
  local namespace="${1}"
  local release_name="${2}"
  local playwright_project="${3}"
  # shellcheck disable=SC2034  # nameref variable used via indirection
  local -n failed_tests="${4}"  # NOSONAR - nameref is used when passed to run_failed_tests_and_report

  log::info "Deploying RBAC to namespace: ${namespace}"

  # Configure namespaces
  configure_namespace "${NAME_SPACE_POSTGRES_DB}"
  configure_namespace "${namespace}"
  configure_external_postgres_db "${namespace}"

  cd "${DIR}"

  local rbac_rhdh_base_url="https://${release_name}-developer-hub-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"
  apply_yaml_files "${DIR}" "${namespace}" "${rbac_rhdh_base_url}"

  log::info "Deploying RBAC image from repository: ${QUAY_REPO}, TAG_NAME: ${TAG_NAME}"

  # Use the same deployment logic as PR jobs (skip orchestrator)
  local merged_pr_rbac_value_file="/tmp/merged-values_showcase-rbac_PR.yaml"
  yq_merge_value_files "merge" "${DIR}/value_files/${HELM_CHART_RBAC_VALUE_FILE_NAME}" "${DIR}/value_files/diff-values_showcase-rbac_PR.yaml" "${merged_pr_rbac_value_file}"
  disable_orchestrator_plugins_in_values "${merged_pr_rbac_value_file}"

  mkdir -p "${ARTIFACT_DIR}/${namespace}"
  cp -a "${merged_pr_rbac_value_file}" "${ARTIFACT_DIR}/${namespace}/" || true

  # shellcheck disable=SC2046
  helm upgrade -i "${release_name}" -n "${namespace}" \
    "${HELM_CHART_URL}" --version "${CHART_VERSION}" \
    -f "${merged_pr_rbac_value_file}" \
    --set global.clusterRouterBase="${K8S_CLUSTER_ROUTER_BASE}" \
    $(get_image_helm_set_params)

  # Wait for deployment and run failed tests
  local url="https://${release_name}-developer-hub-${namespace}.${K8S_CLUSTER_ROUTER_BASE}"

  if check_backstage_running "${release_name}" "${namespace}" "${url}"; then
    log::info "RBAC Backstage is running. Running failed tests..."
    run_failed_tests_and_report "${namespace}" "${playwright_project}" "${url}" failed_tests[@]
    local result=$?
    save_all_pod_logs "${namespace}"
    return ${result}
  else
    log::error "RBAC Backstage deployment failed in ${namespace}"
    save_all_pod_logs "${namespace}"
    return 1
  fi
}

#######################################
# Run failed tests and save results/artifacts
# Arguments:
#   namespace: Kubernetes namespace
#   playwright_project: Playwright project name
#   url: Backstage URL
#   test_files_ref: Name reference to array of test files to run
#######################################
run_failed_tests_and_report() {
  local namespace="${1}"
  local playwright_project="${2}"
  local url="${3}"
  # shellcheck disable=SC2034  # nameref variable used via indirection
  local -n test_files="${4}"

  CURRENT_DEPLOYMENT=$((CURRENT_DEPLOYMENT + 1))
  save_status_deployment_namespace "${CURRENT_DEPLOYMENT}" "${namespace}"
  save_status_failed_to_deploy "${CURRENT_DEPLOYMENT}" false

  BASE_URL="${url}"
  export BASE_URL

  log::info "BASE_URL: ${BASE_URL}"
  log::info "Running ${#test_files[@]} previously failed tests for project '${playwright_project}'"

  cd "${DIR}/../../e2e-tests"
  local e2e_tests_dir
  e2e_tests_dir=$(pwd)

  yarn install --immutable > /tmp/yarn.install.log.txt 2>&1
  local install_status=$?
  if [[ ${install_status} -ne 0 ]]; then
    log::error "=== YARN INSTALL FAILED ==="
    cat /tmp/yarn.install.log.txt
    return ${install_status}
  fi
  log::success "Yarn install completed successfully."

  yarn playwright install chromium

  Xvfb :99 &
  export DISPLAY=:99

  # Run only the specific failed test files
  (
    set -e
    log::info "Using PR container image: ${TAG_NAME}"
    log::info "Running tests: ${test_files[*]}"
    yarn playwright test --project="${playwright_project}" "${test_files[@]}"
  ) 2>&1 | tee "/tmp/${LOGFILE}"

  local result=${PIPESTATUS[0]}

  pkill Xvfb || true

  # Save artifacts
  mkdir -p "${ARTIFACT_DIR}/${namespace}/test-results"
  mkdir -p "${ARTIFACT_DIR}/${namespace}/attachments/screenshots"
  cp -a "${e2e_tests_dir}/test-results/"* "${ARTIFACT_DIR}/${namespace}/test-results" || true
  cp -a "${e2e_tests_dir}/${JUNIT_RESULTS}" "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" || true
  if [[ "${CI}" == "true" ]]; then
    cp "${ARTIFACT_DIR}/${namespace}/${JUNIT_RESULTS}" "${SHARED_DIR}/junit-results-${namespace}.xml" || true
  fi

  cp -a "${e2e_tests_dir}/screenshots/"* "${ARTIFACT_DIR}/${namespace}/attachments/screenshots/" || true
  ansi2html < "/tmp/${LOGFILE}" > "/tmp/${LOGFILE}.html"
  cp -a "/tmp/${LOGFILE}.html" "${ARTIFACT_DIR}/${namespace}" || true
  cp -a "${e2e_tests_dir}/playwright-report/"* "${ARTIFACT_DIR}/${namespace}" || true

  log::info "Rerun tests in namespace '${namespace}' RESULT: ${result}"

  if [[ ${result} -ne 0 ]]; then
    save_overall_result 1
    save_status_test_failed "${CURRENT_DEPLOYMENT}" true
  else
    save_status_test_failed "${CURRENT_DEPLOYMENT}" false
  fi

  # Count failures from new JUnit results
  if [[ -f "${e2e_tests_dir}/${JUNIT_RESULTS}" ]]; then
    local failed_tests_count
    failed_tests_count=$(grep -oP 'failures="\K[0-9]+' "${e2e_tests_dir}/${JUNIT_RESULTS}" | head -n 1)
    log::info "Number of failed tests after rerun: ${failed_tests_count:-0}"
    save_status_number_of_test_failed "${CURRENT_DEPLOYMENT}" "${failed_tests_count:-0}"
  else
    log::warn "JUnit results file not found: ${e2e_tests_dir}/${JUNIT_RESULTS}"
    save_status_number_of_test_failed "${CURRENT_DEPLOYMENT}" "unknown"
  fi

  return ${result}
}
