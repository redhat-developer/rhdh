#!/bin/bash
#
# Utility functions for re-running failed tests from previous CI executions.
#
# This script provides functions to:
# - Fetch JUnit XML results from previous GCS artifacts
# - Parse failed test names from JUnit XML
# - Build URLs to access previous run artifacts
# - Execute only the tests that failed in the previous run
#

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# GCS base URL for OpenShift CI test artifacts
readonly GCS_BASE_URL="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results"

# GitHub API base URL
readonly GITHUB_API_URL="https://api.github.com"

# The job name we want to find previous failed runs for
readonly RERUN_TARGET_JOB="pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm"

#######################################
# Validate required dependencies are available
# Returns:
#   0 if all dependencies available, 1 otherwise
#######################################
validate_dependencies() {
  local missing=()

  for cmd in curl jq; do
    if ! command -v "${cmd}" &> /dev/null; then
      missing+=("${cmd}")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    log::error "Missing required dependencies: ${missing[*]}"
    log::error "Please install them before running this script"
    return 1
  fi

  return 0
}

#######################################
# Build GitHub API auth header if token available
# Outputs:
#   Writes auth header arguments for curl to stdout
#######################################
get_github_auth_header() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "-H" "Authorization: Bearer ${GITHUB_TOKEN}"
  fi

  return 0
}

#######################################
# Make authenticated GitHub API request with error handling
# Arguments:
#   endpoint: API endpoint (e.g., "/repos/org/repo/pulls/123")
# Outputs:
#   Writes JSON response to stdout
# Returns:
#   0 if successful, 1 if failed
#######################################
github_api_request() {
  local endpoint="${1}"
  local url="${GITHUB_API_URL}${endpoint}"
  local response_file
  response_file=$(mktemp)
  local http_status

  # Build curl args with optional auth
  local curl_args=(-sS -w "%{http_code}" -o "${response_file}")
  curl_args+=(-H "Accept: application/vnd.github.v3+json")

  # Add auth header if GITHUB_TOKEN is set
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  http_status=$(curl "${curl_args[@]}" "${url}")

  if [[ "${http_status}" =~ ^2[0-9][0-9]$ ]]; then
    cat "${response_file}"
    rm -f "${response_file}"
    return 0
  else
    log::warn "GitHub API request failed (HTTP ${http_status}): ${endpoint}"
    rm -f "${response_file}"
    return 1
  fi
}

#######################################
# Build the GCS artifact URL for a specific job run
# Arguments:
#   org: GitHub organization (e.g., "redhat-developer")
#   repo: Repository name (e.g., "rhdh")
#   pr_number: Pull request number
#   job_name: CI job name (e.g., "pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm")
#   build_id: Prow build ID
#   namespace: Test namespace (e.g., "showcase" or "showcase-rbac")
# Outputs:
#   Writes the constructed URL to stdout
#######################################
build_previous_run_artifact_url() {
  local org="${1}"
  local repo="${2}"
  local pr_number="${3}"
  local job_name="${4}"
  local build_id="${5}"
  local namespace="${6}"

  local url="${GCS_BASE_URL}/pr-logs/pull/${org}_${repo}/${pr_number}/${job_name}/${build_id}"
  url="${url}/artifacts/e2e-ocp-helm/redhat-developer-rhdh-ocp-helm/artifacts/${namespace}/junit-results.xml"

  echo "${url}"
}

#######################################
# Get the previous build ID for a specific job from GitHub API
# Arguments:
#   org: GitHub organization
#   repo: Repository name
#   pr_number: Pull request number
#   target_job: Job name to find (default: RERUN_TARGET_JOB)
# Outputs:
#   Writes the build ID to stdout, or empty string if not found
# Returns:
#   0 if build ID found, 1 otherwise
#######################################
get_previous_failed_build_id() {
  local org="${1}"
  local repo="${2}"
  local pr_number="${3}"
  local target_job="${4:-${RERUN_TARGET_JOB}}"

  log::info "Fetching check runs for PR #${pr_number} in ${org}/${repo}..."

  # Get the PR's head SHA first
  local pr_response
  if ! pr_response=$(github_api_request "/repos/${org}/${repo}/pulls/${pr_number}"); then
    log::error "Failed to fetch PR information"
    return 1
  fi

  local head_sha
  head_sha=$(echo "${pr_response}" | jq -r '.head.sha // empty')

  if [[ -z "${head_sha}" ]]; then
    log::error "Could not get PR head SHA from response"
    return 1
  fi

  log::info "PR head SHA: ${head_sha}"

  # Get check runs for this commit
  local check_runs_response
  if ! check_runs_response=$(github_api_request "/repos/${org}/${repo}/commits/${head_sha}/check-runs"); then
    log::error "Failed to fetch check runs"
    return 1
  fi

  # Find the most recent completed check run matching our target job
  # Sort by completed_at descending to get the most recent
  local details_url
  details_url=$(echo "${check_runs_response}" | jq -r \
    --arg job "${target_job}" \
    '[.check_runs[] | select(.name == $job and .conclusion != null)]
     | sort_by(.completed_at) | reverse | .[0].details_url // empty')

  if [[ -z "${details_url}" || "${details_url}" == "null" ]]; then
    log::warn "No completed check run found for job: ${target_job}"
    return 1
  fi

  log::info "Found details URL: ${details_url}"

  # Extract build ID from the details URL using a more precise pattern
  # URL format: https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/org_repo/pr/job/BUILD_ID
  local build_id
  build_id=$(echo "${details_url}" | sed -n 's|.*/\([0-9]\{10,\}\)$|\1|p')

  # Fallback to grep if sed didn't match
  if [[ -z "${build_id}" ]]; then
    build_id=$(echo "${details_url}" | grep -oE '/[0-9]{10,}$' | tr -d '/')
  fi

  if [[ -z "${build_id}" ]]; then
    log::error "Could not extract build ID from details URL: ${details_url}"
    return 1
  fi

  log::success "Found previous build ID: ${build_id}"
  echo "${build_id}"
}

#######################################
# Fetch JUnit results XML from GCS for a specific namespace
# Arguments:
#   artifact_url: Full URL to the junit-results.xml file
#   output_file: Local path to save the XML file
# Returns:
#   0 if successful, 1 if failed
#######################################
fetch_previous_junit_results() {
  local artifact_url="${1}"
  local output_file="${2}"

  log::info "Fetching JUnit results from: ${artifact_url}"

  local http_status
  http_status=$(curl -sS -w "%{http_code}" -o "${output_file}" "${artifact_url}")

  if [[ "${http_status}" == "200" ]]; then
    # Validate the downloaded file is valid XML
    if [[ -s "${output_file}" ]] && head -1 "${output_file}" | grep -q '<?xml'; then
      log::success "Successfully downloaded JUnit results"
      return 0
    else
      log::warn "Downloaded file is not valid XML"
      rm -f "${output_file}"
      return 1
    fi
  else
    log::warn "Failed to fetch JUnit results (HTTP ${http_status})"
    rm -f "${output_file}"
    return 1
  fi
}

#######################################
# Parse failed test names from JUnit XML file
# Arguments:
#   junit_file: Path to the JUnit XML file
# Outputs:
#   Writes failed test file paths to stdout, one per line
# Returns:
#   0 if parsing successful (even if no failures), 1 if file not found or parsing error
#######################################
parse_failed_tests_from_junit() {
  local junit_file="${1}"

  if [[ ! -f "${junit_file}" ]]; then
    log::error "JUnit file not found: ${junit_file}"
    return 1
  fi

  log::info "Parsing failed tests from: ${junit_file}"

  # Use xmllint if available for more robust parsing
  if command -v xmllint &> /dev/null; then
    # Extract file paths from testcases with failures, handling multiple attributes properly
    local xpath_result
    xpath_result=$(xmllint --xpath '//testcase[failure]/@file' "${junit_file}" 2> /dev/null || echo "")

    if [[ -n "${xpath_result}" ]]; then
      # Parse file="..." attributes, one per line
      echo "${xpath_result}" | grep -oP 'file="\K[^"]+' | sort -u
    fi
  else
    # Fallback: use grep/sed for systems without xmllint
    # Match testcase elements that contain a failure child element
    grep -zoP '<testcase[^>]*file="[^"]*"[^>]*>.*?<failure' "${junit_file}" 2> /dev/null \
      | grep -oP 'file="\K[^"]+' \
      | sort -u
  fi

  return 0
}

#######################################
# Get the count of failed tests from JUnit XML
# Arguments:
#   junit_file: Path to the JUnit XML file
# Outputs:
#   Writes the number of failures to stdout
#######################################
get_failed_test_count() {
  local junit_file="${1}"

  if [[ ! -f "${junit_file}" ]]; then
    echo "0"
    return
  fi

  # Use xmllint for accurate count if available
  if command -v xmllint &> /dev/null; then
    local count
    count=$(xmllint --xpath 'count(//testcase[failure])' "${junit_file}" 2> /dev/null || echo "0")
    echo "${count%.*}" # Remove decimal if present
  else
    # Fallback: sum failures attributes from all testsuites
    local total=0
    while IFS= read -r failures; do
      total=$((total + failures))
    done < <(grep -oP 'failures="\K[0-9]+' "${junit_file}" 2> /dev/null)
    echo "${total}"
  fi

  return 0
}

#######################################
# Run only the specified failed tests using Playwright
# Arguments:
#   playwright_project: The Playwright project name (e.g., "showcase" or "showcase-rbac")
#   test_files: Array of test file paths to run
# Returns:
#   Exit code from Playwright
#######################################
run_failed_tests_only() {
  local playwright_project="${1}"
  shift
  local test_files=("$@")

  if [[ ${#test_files[@]} -eq 0 ]]; then
    log::warn "No test files specified to run"
    return 0
  fi

  log::section "Running Failed Tests Only"
  log::info "Project: ${playwright_project}"
  log::info "Test files to run:"
  for file in "${test_files[@]}"; do
    log::info "  - ${file}"
  done

  cd "${DIR}/../../e2e-tests" || return 1

  yarn install --immutable > /tmp/yarn.install.log.txt 2>&1
  local install_status=$?
  if [[ ${install_status} -ne 0 ]]; then
    log::error "Yarn install failed"
    cat /tmp/yarn.install.log.txt
    return ${install_status}
  fi

  yarn playwright install chromium

  Xvfb :99 &
  export DISPLAY=:99

  log::info "Executing Playwright tests..."
  yarn playwright test --project="${playwright_project}" "${test_files[@]}"
  local result=$?

  pkill Xvfb || true

  return ${result}
}

#######################################
# Get PR information from environment or git
# Outputs:
#   Sets PULL_NUMBER, REPO_OWNER, REPO_NAME environment variables
#######################################
get_pr_info() {
  if [[ -n "${PULL_NUMBER:-}" ]]; then
    log::info "Using PR number from environment: ${PULL_NUMBER}"
  else
    if [[ -n "${PULL_REFS:-}" ]]; then
      PULL_NUMBER=$(echo "${PULL_REFS}" | grep -oP ':\K[0-9]+' | head -n 1)
      export PULL_NUMBER
    fi
  fi

  export REPO_OWNER="${REPO_OWNER:-redhat-developer}"
  export REPO_NAME="${REPO_NAME:-rhdh}"

  log::info "PR Info: ${REPO_OWNER}/${REPO_NAME}#${PULL_NUMBER:-unknown}"

  return 0
}

#######################################
# Check if test file exists in the current codebase
# Arguments:
#   test_file: Path to the test file (relative to repo root)
# Returns:
#   0 if file exists, 1 otherwise
#######################################
test_file_exists() {
  local test_file="${1}"
  local full_path="${DIR}/../../${test_file}"

  if [[ -f "${full_path}" ]]; then
    return 0
  else
    log::warn "Test file no longer exists: ${test_file}"
    return 1
  fi
}

#######################################
# Filter test files to only include those that still exist
# Arguments:
#   test_files: Array of test file paths
# Outputs:
#   Writes existing test file paths to stdout
#######################################
filter_existing_test_files() {
  local test_files=("$@")
  local existing_files=()

  for file in "${test_files[@]}"; do
    if test_file_exists "${file}"; then
      existing_files+=("${file}")
    fi
  done

  printf '%s\n' "${existing_files[@]}"

  return 0
}
