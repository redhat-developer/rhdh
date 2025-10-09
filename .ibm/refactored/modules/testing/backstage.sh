#!/usr/bin/env bash
#
# Backstage Testing Module
#

# Guard to prevent multiple sourcing
if [[ -n "${_BACKSTAGE_TESTING_LOADED:-}" ]]; then
    return 0
fi
readonly _BACKSTAGE_TESTING_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/../logging.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../reporting.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../constants.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../retry.sh"

check_and_test() {
    local release_name="$1"
    local namespace="$2"
    local url="$3"
    local max_attempts="${4:-30}"
    local wait_time="${5:-30}"

    log_info "Checking if Backstage is up and running at ${url}"

    if [[ -z "${url}" ]]; then
        log_error "URL is not set. Please provide a valid URL."
        return 1
    fi

    # Wait for Backstage to respond with HTTP 200
    # This is the approach used by the original code
    local attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        local http_status=$(curl --insecure -I -s -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null || echo "000")

        if [[ "${http_status}" == "200" ]]; then
            log_success "✅ Backstage is up and running!"
            export BASE_URL="${url}"
            log_info "BASE_URL: ${BASE_URL}"
            
            # Display pods for verification
            log_info "Display pods for verification..."
            kubectl get pods -n "${namespace}" || true
            
            # Run tests
            run_tests "${release_name}" "${namespace}"
            return $?
        else
            log_info "Attempt ${attempt} of ${max_attempts}: Backstage not yet available (HTTP Status: ${http_status})"
            kubectl get pods -n "${namespace}" || true
            sleep "${wait_time}"
        fi
        
        attempt=$((attempt + 1))
    done

    # If we reach here, Backstage never became available
    log_error "❌ Backstage is not running after ${max_attempts} attempts"
    
    # Collect diagnostic information
    log_info "Collecting diagnostic information..."
    kubectl get all -n "${namespace}" || true
    collect_deployment_logs "${namespace}"
    
    # Save test status as failed
    save_test_status "${namespace}" "failed" 0 1

    return 1
}

# Function to run the actual tests after Backstage is up
run_tests() {
    local release_name="$1"
    local namespace="$2"

    log_info "Running tests for ${release_name} in namespace ${namespace}"
    
    # Track test results
    local test_count=0
    local failed_count=0

    # Run API tests if enabled
    if [[ "${RUN_API_TESTS:-false}" == "true" ]]; then
        test_count=$((test_count + 1))
        if ! run_api_tests "${BASE_URL}"; then
            failed_count=$((failed_count + 1))
        fi
    fi

    # Run UI tests if enabled
    if [[ "${RUN_UI_TESTS:-false}" == "true" ]]; then
        test_count=$((test_count + 1))
        if ! run_ui_tests "${BASE_URL}"; then
            failed_count=$((failed_count + 1))
        fi
    fi

    # Process JUnit results if they exist
    local junit_file="${ARTIFACT_DIR}/${namespace}/junit-results.xml"
    if [[ -f "${junit_file}" ]]; then
        process_junit_results "${namespace}" "${junit_file}"
    else
        # Save test status based on our counts
        local status=$([[ ${failed_count} -eq 0 ]] && echo "success" || echo "failed")
        save_test_status "${namespace}" "${status}" "${test_count}" "${failed_count}"
    fi

    # Always collect logs for analysis
    collect_deployment_logs "${namespace}"
    
    # Return status
    if [[ ${failed_count} -eq 0 ]]; then
        log_success "All tests passed for ${release_name}"
        return 0
    else
        log_error "Some tests failed for ${release_name} (${failed_count}/${test_count})"
        return 1
    fi
}

run_health_check() {
    local url="$1"
    local health_endpoint="${url}/api/health"

    log_info "Running health check: ${health_endpoint}"

    # Use curl with timeout and retry
    local response_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --connect-timeout 10 --max-time 30 \
        "${health_endpoint}" 2>/dev/null || echo "000")

    if [[ "${response_code}" == "200" ]]; then
        log_success "Health check passed (HTTP ${response_code})"
        return 0
    elif [[ "${response_code}" == "000" ]]; then
        log_error "Health check failed - could not connect to ${health_endpoint}"
        return 1
    else
        log_error "Health check failed (HTTP ${response_code})"
        return 1
    fi
}

run_health_check_with_retry() {
    local url="$1"
    local max_retries="${2:-5}"
    local retry_delay="${3:-10}"

    log_info "Running health check with retry (max ${max_retries} attempts)"

    local attempt=1
    local delay=$retry_delay

    while [[ $attempt -le $max_retries ]]; do
        if run_health_check "${url}"; then
            return 0
        fi

        if [[ $attempt -lt $max_retries ]]; then
            log_info "Health check attempt ${attempt}/${max_retries} failed, retrying in ${delay}s..."
            sleep "$delay"
            # Exponential backoff with max delay of 60s
            delay=$((delay * 2))
            [[ $delay -gt 60 ]] && delay=60
        fi

        attempt=$((attempt + 1))
    done

    log_error "Health check failed after ${max_retries} attempts"
    return 1
}

run_api_tests() {
    local base_url="$1"

    log_info "Running API tests against ${base_url}"

    # Test catalog API
    local catalog_response=$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/api/catalog/entities")
    if [[ "${catalog_response}" == "200" ]]; then
        log_success "Catalog API test passed"
    else
        log_error "Catalog API test failed (HTTP ${catalog_response})"
    fi

    # Test tech docs API
    local techdocs_response=$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/api/techdocs")
    if [[ "${techdocs_response}" == "200" ]] || [[ "${techdocs_response}" == "404" ]]; then
        log_success "TechDocs API test passed"
    else
        log_error "TechDocs API test failed (HTTP ${techdocs_response})"
    fi
}

run_ui_tests() {
    local base_url="$1"

    log_info "Running UI smoke tests against ${base_url}"

    # Check if main page loads
    local ui_response=$(curl -s -o /dev/null -w "%{http_code}" "${base_url}")
    if [[ "${ui_response}" == "200" ]]; then
        log_success "UI main page test passed"
    else
        log_error "UI main page test failed (HTTP ${ui_response})"
    fi

    # Check for critical UI elements
    local page_content=$(curl -s "${base_url}")
    if echo "${page_content}" | grep -q "Backstage"; then
        log_success "UI content verification passed"
    else
        log_warning "UI content verification needs review"
    fi
}

run_e2e_tests() {
    local namespace="$1"
    local base_url="$2"

    log_info "Running E2E tests in namespace ${namespace}"

    # Set test environment variables
    export BASE_URL="${base_url}"
    export NAMESPACE="${namespace}"

    # Run test suite if available
    if [[ -f "${DIR}/e2e-tests/run-tests.sh" ]]; then
        bash "${DIR}/e2e-tests/run-tests.sh"
    else
        log_warning "E2E test suite not found, skipping"
    fi
}

# Export functions
export -f check_and_test run_tests run_health_check run_health_check_with_retry run_api_tests run_ui_tests run_e2e_tests