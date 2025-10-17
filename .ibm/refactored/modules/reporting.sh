#!/usr/bin/env bash
#
# Reporting Module - Test results and status tracking
#

# Guard to prevent multiple sourcing
if [[ -n "${_REPORTING_LOADED:-}" ]]; then
    return 0
fi
readonly _REPORTING_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"

# ============================================================================
# REPORTING VARIABLES
# ============================================================================

# Use declare -A for associative arrays (works in Bash 4+)
# For older Bash versions, we'll use regular arrays as fallback
if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
    declare -A DEPLOYMENT_STATUS    # Track deployment status by namespace
    declare -A TEST_STATUS          # Track test status by namespace
else
    # Fallback for older Bash - use regular arrays
    DEPLOYMENT_STATUS_NS=()         # Namespace list
    DEPLOYMENT_STATUS_VAL=()        # Status values
    TEST_STATUS_NS=()               # Namespace list
    TEST_STATUS_VAL=()              # Status values
fi

# Global variable (works in all versions)
OVERALL_RESULT=0                    # Overall result (0=success, 1=failure)

# ============================================================================
# DIRECTORY MANAGEMENT
# ============================================================================

init_reporting_directories() {
    # Ensure reporting directories exist
    mkdir -p "${ARTIFACT_DIR}/reporting"
    mkdir -p "${SHARED_DIR}"

    log_debug "Initialized reporting directories"
}

# ============================================================================
# STATUS TRACKING - SIMPLIFIED
# ============================================================================

save_deployment_status() {
    local namespace="$1"
    local status="$2"  # success/failed
    local details="${3:-}"

    # Store status based on Bash version
    if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
        DEPLOYMENT_STATUS["${namespace}"]="${status}"
    else
        # Fallback for older Bash - use parallel arrays
        local found=0
        for i in "${!DEPLOYMENT_STATUS_NS[@]}"; do
            if [[ "${DEPLOYMENT_STATUS_NS[$i]}" == "${namespace}" ]]; then
                DEPLOYMENT_STATUS_VAL[$i]="${status}"
                found=1
                break
            fi
        done
        if [[ $found -eq 0 ]]; then
            DEPLOYMENT_STATUS_NS+=("${namespace}")
            DEPLOYMENT_STATUS_VAL+=("${status}")
        fi
    fi

    # Save to file for persistence
    {
        echo "namespace: ${namespace}"
        echo "status: ${status}"
        echo "timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        [[ -n "${details}" ]] && echo "details: ${details}"
    } > "${ARTIFACT_DIR}/reporting/deployment-${namespace}.status"

    log_info "Saved deployment status for ${namespace}: ${status}"

    # Update overall result
    [[ "${status}" == "failed" ]] && OVERALL_RESULT=1
}

save_test_status() {
    local namespace="$1"
    local status="$2"  # success/failed
    local test_count="${3:-0}"
    local failed_count="${4:-0}"

    # Store status based on Bash version
    if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
        TEST_STATUS["${namespace}"]="${status}"
    else
        # Fallback for older Bash
        local found=0
        for i in "${!TEST_STATUS_NS[@]}"; do
            if [[ "${TEST_STATUS_NS[$i]}" == "${namespace}" ]]; then
                TEST_STATUS_VAL[$i]="${status}"
                found=1
                break
            fi
        done
        if [[ $found -eq 0 ]]; then
            TEST_STATUS_NS+=("${namespace}")
            TEST_STATUS_VAL+=("${status}")
        fi
    fi

    # Save to file
    {
        echo "namespace: ${namespace}"
        echo "status: ${status}"
        echo "total_tests: ${test_count}"
        echo "failed_tests: ${failed_count}"
        echo "timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    } > "${ARTIFACT_DIR}/reporting/test-${namespace}.status"

    log_info "Saved test status for ${namespace}: ${status} (${failed_count}/${test_count} failed)"

    # Update overall result
    [[ "${status}" == "failed" ]] && OVERALL_RESULT=1
}

save_overall_result() {
    local result="${1:-${OVERALL_RESULT}}"

    OVERALL_RESULT="${result}"

    {
        echo "overall_result: ${OVERALL_RESULT}"
        echo "timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

        # Include summary based on Bash version
        echo "deployments:"
        if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
            for ns in "${!DEPLOYMENT_STATUS[@]}"; do
                echo "  - ${ns}: ${DEPLOYMENT_STATUS[$ns]}"
            done
        else
            for i in "${!DEPLOYMENT_STATUS_NS[@]}"; do
                echo "  - ${DEPLOYMENT_STATUS_NS[$i]}: ${DEPLOYMENT_STATUS_VAL[$i]}"
            done
        fi

        echo "tests:"
        if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
            for ns in "${!TEST_STATUS[@]}"; do
                echo "  - ${ns}: ${TEST_STATUS[$ns]}"
            done
        else
            for i in "${!TEST_STATUS_NS[@]}"; do
                echo "  - ${TEST_STATUS_NS[$i]}: ${TEST_STATUS_VAL[$i]}"
            done
        fi
    } > "${ARTIFACT_DIR}/reporting/overall-result.txt"

    # Also save to shared dir for CI integration
    cp "${ARTIFACT_DIR}/reporting/overall-result.txt" "${SHARED_DIR}/OVERALL_RESULT.txt" 2>/dev/null || true

    local result_text=$([[ "${OVERALL_RESULT}" -eq 0 ]] && echo "SUCCESS" || echo "FAILURE")
    log_info "Overall result: ${result_text}"
}

# ============================================================================
# JUNIT RESULTS PROCESSING
# ============================================================================

process_junit_results() {
    local namespace="$1"
    local junit_file="${2:-${ARTIFACT_DIR}/${namespace}/junit-results.xml}"

    if [[ ! -f "${junit_file}" ]]; then
        log_warning "JUnit file not found: ${junit_file}"
        return 1
    fi

    # Create backup
    cp "${junit_file}" "${junit_file}.original" 2>/dev/null || true

    # Process for Data Router if in OpenShift CI
    if [[ "${OPENSHIFT_CI}" == "true" ]]; then
        process_junit_for_data_router "${namespace}" "${junit_file}"
    fi

    # Extract test counts
    local total_tests=$(grep -c '<testcase' "${junit_file}" 2>/dev/null || echo "0")
    local failed_tests=$(grep -c '<failure\|<error' "${junit_file}" 2>/dev/null || echo "0")

    log_info "JUnit results for ${namespace}: ${failed_tests}/${total_tests} failed"

    # Save test status based on results
    local status=$([[ ${failed_tests} -eq 0 ]] && echo "success" || echo "failed")
    save_test_status "${namespace}" "${status}" "${total_tests}" "${failed_tests}"
}

process_junit_for_data_router() {
    local namespace="$1"
    local junit_file="$2"

    [[ "${OPENSHIFT_CI}" != "true" ]] && return 0

    local artifacts_url=$(get_artifacts_url "${namespace}")

    # Replace attachments with links to OpenShift CI storage
    sed -i.bak "s#\[\[ATTACHMENT|\(.*\)\]\]#${artifacts_url}/\1#g" "${junit_file}"

    # Fix XML property tags format for Data Router compatibility
    # Convert to self-closing format
    sed -i.bak 's#</property>##g' "${junit_file}"
    sed -i.bak 's#<property name="\([^"]*\)" value="\([^"]*\)">#<property name="\1" value="\2"/>#g' "${junit_file}"

    # Copy to shared directory for CI
    cp "${junit_file}" "${SHARED_DIR}/junit-results-${namespace}.xml" 2>/dev/null || true

    log_info "JUnit results adapted for Data Router and saved"
}

# ============================================================================
# URL GENERATION FOR OPENSHIFT CI
# ============================================================================

get_artifacts_url() {
    local namespace="$1"

    [[ -z "${namespace}" ]] && return 1

    local base_url="https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results"
    local artifacts_url=""

    if [[ -n "${PULL_NUMBER:-}" ]]; then
        # PR build
        local suite_name="${JOB_NAME##*e2e-tests-}"
        local part="${REPO_OWNER}_${REPO_NAME}"
        artifacts_url="${base_url}/pr-logs/pull/${part}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}/artifacts/${namespace}"
    else
        # Periodic build
        artifacts_url="${base_url}/logs/${JOB_NAME}/${BUILD_ID}/artifacts/${namespace}"
    fi

    echo "${artifacts_url}"
}

get_job_url() {
    local base_url="https://prow.ci.openshift.org/view/gs/test-platform-results"

    if [[ -n "${PULL_NUMBER:-}" ]]; then
        echo "${base_url}/pr-logs/pull/${REPO_OWNER}_${REPO_NAME}/${PULL_NUMBER}/${JOB_NAME}/${BUILD_ID}"
    else
        echo "${base_url}/logs/${JOB_NAME}/${BUILD_ID}"
    fi
}

# ============================================================================
# LOG COLLECTION
# ============================================================================

collect_deployment_logs() {
    local namespace="$1"
    local output_dir="${ARTIFACT_DIR}/${namespace}/logs"

    mkdir -p "${output_dir}"

    log_info "Collecting logs from namespace ${namespace}"

    # Collect pod logs
    kubectl get pods -n "${namespace}" -o wide > "${output_dir}/pods.txt" 2>&1 || true

    # Collect logs from all pods
    local pods=$(kubectl get pods -n "${namespace}" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
    for pod in ${pods}; do
        # Aggregate logs for quick view
        kubectl logs "${pod}" -n "${namespace}" --all-containers=true > "${output_dir}/${pod}.log" 2>&1 || true
        kubectl describe pod "${pod}" -n "${namespace}" > "${output_dir}/${pod}-describe.txt" 2>&1 || true

        # Detailed per-container logs (including init containers and previous)
        local containers=$(kubectl get pod "${pod}" -n "${namespace}" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null || true)
        for c in ${containers}; do
            kubectl logs "${pod}" -c "${c}" -n "${namespace}" > "${output_dir}/${pod}_${c}.log" 2>&1 || true
            kubectl logs "${pod}" -c "${c}" -n "${namespace}" --previous > "${output_dir}/${pod}_${c}-previous.log" 2>/dev/null || true
        done

        local init_containers=$(kubectl get pod "${pod}" -n "${namespace}" -o jsonpath='{.spec.initContainers[*].name}' 2>/dev/null || true)
        for ic in ${init_containers}; do
            kubectl logs "${pod}" -c "${ic}" -n "${namespace}" > "${output_dir}/${pod}_${ic}.log" 2>&1 || true
            kubectl logs "${pod}" -c "${ic}" -n "${namespace}" --previous > "${output_dir}/${pod}_${ic}-previous.log" 2>/dev/null || true
        done
    done

    # Collect events
    kubectl get events -n "${namespace}" --sort-by='.lastTimestamp' > "${output_dir}/events.txt" 2>&1 || true

    # Collect deployment status
    kubectl get deployments -n "${namespace}" -o wide > "${output_dir}/deployments.txt" 2>&1 || true

    # Collect configmaps and secrets (names only)
    kubectl get configmaps -n "${namespace}" > "${output_dir}/configmaps.txt" 2>&1 || true
    kubectl get secrets -n "${namespace}" > "${output_dir}/secrets.txt" 2>&1 || true

    log_success "Logs collected for ${namespace}"
}

# ============================================================================
# SLACK NOTIFICATION (SIMPLIFIED)
# ============================================================================

send_slack_notification() {
    local status="$1"  # success/failure
    local message="$2"
    local namespace="${3:-}"

    # Skip if no webhook URL
    [[ -z "${SLACK_DATA_ROUTER_WEBHOOK_URL:-}" ]] && return 0

    local color=$([[ "${status}" == "success" ]] && echo "good" || echo "danger")
    local job_url=$(get_job_url)

    local payload=$(cat <<EOF
{
  "attachments": [{
    "color": "${color}",
    "title": "Test Results: ${JOB_NAME}",
    "text": "${message}",
    "fields": [
      {"title": "Job", "value": "${JOB_NAME}", "short": true},
      {"title": "Status", "value": "${status}", "short": true},
      {"title": "Namespace", "value": "${namespace:-N/A}", "short": true},
      {"title": "Build", "value": "${BUILD_ID}", "short": true}
    ],
    "footer": "OpenShift CI",
    "footer_icon": "https://www.openshift.com/favicon.ico",
    "ts": $(date +%s),
    "actions": [{
      "type": "button",
      "text": "View Job",
      "url": "${job_url}"
    }]
  }]
}
EOF
)

    curl -X POST "${SLACK_DATA_ROUTER_WEBHOOK_URL}" \
        -H 'Content-Type: application/json' \
        -d "${payload}" 2>/dev/null || true

    log_debug "Slack notification sent: ${status}"
}

# ============================================================================
# SUMMARY GENERATION
# ============================================================================

generate_summary_report() {
    # Check if there's anything to report
    local has_deployments=0
    local has_tests=0
    
    if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
        [[ ${#DEPLOYMENT_STATUS[@]} -gt 0 ]] && has_deployments=1
        [[ ${#TEST_STATUS[@]} -gt 0 ]] && has_tests=1
    else
        [[ ${#DEPLOYMENT_STATUS_NS[@]} -gt 0 ]] && has_deployments=1
        [[ ${#TEST_STATUS_NS[@]} -gt 0 ]] && has_tests=1
    fi
    
    # Skip report generation if nothing to report
    if [[ $has_deployments -eq 0 && $has_tests -eq 0 ]]; then
        log_debug "No deployments or tests to report, skipping summary generation"
        return 0
    fi
    
    local report_file="${ARTIFACT_DIR}/reporting/summary.md"

    {
        echo "# Execution Summary"
        echo ""
        echo "**Job:** ${JOB_NAME}"
        echo "**Build:** ${BUILD_ID}"
        echo "**Date:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
        echo ""

        # Overall Result
        local result_text=$([[ "${OVERALL_RESULT}" -eq 0 ]] && echo "✅ SUCCESS" || echo "❌ FAILURE")
        echo "## Overall Result: ${result_text}"
        echo ""

        # Deployment Summary (only if deployments exist)
        if [[ $has_deployments -eq 1 ]]; then
            echo "## Deployments"
            echo ""
            echo "| Namespace | Status |"
            echo "|-----------|--------|"
            if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
                for ns in "${!DEPLOYMENT_STATUS[@]}"; do
                    local icon=$([[ "${DEPLOYMENT_STATUS[$ns]}" == "success" ]] && echo "✅" || echo "❌")
                    echo "| ${ns} | ${icon} ${DEPLOYMENT_STATUS[$ns]} |"
                done
            else
                for i in "${!DEPLOYMENT_STATUS_NS[@]}"; do
                    local ns="${DEPLOYMENT_STATUS_NS[$i]}"
                    local status="${DEPLOYMENT_STATUS_VAL[$i]}"
                    local icon=$([[ "${status}" == "success" ]] && echo "✅" || echo "❌")
                    echo "| ${ns} | ${icon} ${status} |"
                done
            fi
            echo ""
        fi

        # Test Summary (only if tests exist)
        if [[ $has_tests -eq 1 ]]; then
            echo "## Tests"
            echo ""
            echo "| Namespace | Status |"
            echo "|-----------|--------|"
            if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
                for ns in "${!TEST_STATUS[@]}"; do
                    local icon=$([[ "${TEST_STATUS[$ns]}" == "success" ]] && echo "✅" || echo "❌")
                    echo "| ${ns} | ${icon} ${TEST_STATUS[$ns]} |"
                done
            else
                for i in "${!TEST_STATUS_NS[@]}"; do
                    local ns="${TEST_STATUS_NS[$i]}"
                    local status="${TEST_STATUS_VAL[$i]}"
                    local icon=$([[ "${status}" == "success" ]] && echo "✅" || echo "❌")
                    echo "| ${ns} | ${icon} ${status} |"
                done
            fi
            echo ""
        fi

        # Links (only in OpenShift CI and if there are deployments)
        if [[ "${OPENSHIFT_CI}" == "true" && $has_deployments -eq 1 ]]; then
            echo "## Links"
            echo ""
            echo "- [Job Results]($(get_job_url))"
            if [[ ${BASH_VERSION%%.*} -ge 4 ]]; then
                for ns in "${!DEPLOYMENT_STATUS[@]}"; do
                    echo "- [${ns} Artifacts]($(get_artifacts_url "${ns}"))"
                done
            else
                for i in "${!DEPLOYMENT_STATUS_NS[@]}"; do
                    echo "- [${DEPLOYMENT_STATUS_NS[$i]} Artifacts]($(get_artifacts_url "${DEPLOYMENT_STATUS_NS[$i]}"))"
                done
            fi
        fi
    } > "${report_file}"

    log_info "Summary report generated: ${report_file}"

    # Also display to console
    cat "${report_file}"
}

# ============================================================================
# EXPORT FUNCTIONS
# ============================================================================

export -f init_reporting_directories save_deployment_status save_test_status save_overall_result
export -f process_junit_results process_junit_for_data_router
export -f get_artifacts_url get_job_url
export -f collect_deployment_logs send_slack_notification generate_summary_report