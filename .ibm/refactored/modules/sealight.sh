#!/usr/bin/env bash
#
# Sealight Integration Module - Code coverage and quality analysis for RHDH
#

# Guard to prevent multiple sourcing
if [[ -n "${_SEALIGHT_LOADED:-}" ]]; then
    return 0
fi
readonly _SEALIGHT_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"

# ============================================================================
# SEALIGHT CONFIGURATION
# ============================================================================

# Sealight environment variables
export SL_TOKEN="${SL_TOKEN:-}"
export SL_TEST_STAGE="${SL_TEST_STAGE:-e2e-tests-nightly}"
export RHDH_SEALIGHTS_BOT_USER="${RHDH_SEALIGHTS_BOT_USER:-}"
export RHDH_SEALIGHTS_BOT_TOKEN="${RHDH_SEALIGHTS_BOT_TOKEN:-}"

# ============================================================================
# SEALIGHT FUNCTIONS
# ============================================================================

check_sealight_enabled() {
    if [[ "${ENABLE_SEALIGHT:-false}" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

setup_sealight_image_pull_secret() {
    local namespace="${1}"

    if ! check_sealight_enabled; then
        return 0
    fi

    log_info "Setting up Sealight image pull secret in namespace: ${namespace}"

    if [[ -z "${RHDH_SEALIGHTS_BOT_USER}" || -z "${RHDH_SEALIGHTS_BOT_TOKEN}" ]]; then
        log_error "Sealight credentials not configured"
        return 1
    fi

    # Create pull secret for Sealight-instrumented images
    kubectl create secret docker-registry quay-secret \
        --docker-server=quay.io \
        --docker-username="${RHDH_SEALIGHTS_BOT_USER}" \
        --docker-password="${RHDH_SEALIGHTS_BOT_TOKEN}" \
        --namespace="${namespace}" \
        --dry-run=client -o yaml | kubectl apply -f -

    log_success "Sealight image pull secret configured"
}

configure_sealight_playwright() {
    if ! check_sealight_enabled; then
        return 0
    fi

    log_info "Configuring Sealight for Playwright tests"

    # Check if sealights-playwright-plugin is installed
    if [[ ! -d "node_modules/sealights-playwright-plugin" ]]; then
        log_warning "Sealights Playwright plugin not installed"
        return 1
    fi

    # Import and replace Playwright utilities with Sealight instrumentation
    node node_modules/sealights-playwright-plugin/importReplaceUtility.js playwright

    log_success "Sealight Playwright configuration applied"
}

setup_sealight_env_vars() {
    if ! check_sealight_enabled; then
        return 0
    fi

    log_info "Setting up Sealight environment variables"

    # Export Sealight environment variables
    export SL_TOKEN="${SL_TOKEN}"
    export SL_TEST_STAGE="${SL_TEST_STAGE}"
    export SL_BUILD_SESSION_ID="${SL_BUILD_SESSION_ID:-$(date +%s)}"
    export SL_TEST_SESSION_ID="${SL_TEST_SESSION_ID:-${SL_BUILD_SESSION_ID}-test}"

    # Log configuration (without exposing token)
    log_debug "SL_TEST_STAGE: ${SL_TEST_STAGE}"
    log_debug "SL_BUILD_SESSION_ID: ${SL_BUILD_SESSION_ID}"
    log_debug "SL_TEST_SESSION_ID: ${SL_TEST_SESSION_ID}"

    log_success "Sealight environment variables configured"
}

get_sealight_helm_params() {
    if ! check_sealight_enabled; then
        echo ""
        return 0
    fi

    log_info "Generating Sealight Helm parameters"

    local params=""

    # Add image pull secret for Sealight-instrumented images
    params+="--set upstream.backstage.image.pullSecrets[0]='quay-secret' "

    # Use Sealight-instrumented image repository if available
    if [[ -n "${SEALIGHT_IMAGE_REPO:-}" ]]; then
        params+="--set upstream.backstage.image.repository=${SEALIGHT_IMAGE_REPO} "
    fi

    # Use Sealight-instrumented image tag if available
    if [[ -n "${SEALIGHT_IMAGE_TAG:-}" ]]; then
        params+="--set upstream.backstage.image.tag=${SEALIGHT_IMAGE_TAG} "
    fi

    # Add Sealight environment variables
    params+="--set-string upstream.backstage.extraEnvVars[99].name=SL_TOKEN "
    params+="--set-string upstream.backstage.extraEnvVars[99].value='${SL_TOKEN}' "
    params+="--set-string upstream.backstage.extraEnvVars[100].name=SL_TEST_STAGE "
    params+="--set-string upstream.backstage.extraEnvVars[100].value='${SL_TEST_STAGE}' "
    params+="--set-string upstream.backstage.extraEnvVars[101].name=SL_BUILD_SESSION_ID "
    params+="--set-string upstream.backstage.extraEnvVars[101].value='${SL_BUILD_SESSION_ID:-}' "

    echo "${params}"
}

initialize_sealight_reporting() {
    if ! check_sealight_enabled; then
        return 0
    fi

    log_info "Initializing Sealight test reporting"

    # Check if Sealight CLI is available
    if ! command -v sl &>/dev/null; then
        log_warning "Sealight CLI not found, attempting to install"
        npm install -g sealights-cli || {
            log_error "Failed to install Sealight CLI"
            return 1
        }
    fi

    # Start test session
    if [[ -n "${SL_TOKEN}" ]]; then
        sl start-test-session \
            --token "${SL_TOKEN}" \
            --test-stage "${SL_TEST_STAGE}" \
            --session-id "${SL_TEST_SESSION_ID}" || {
            log_warning "Failed to start Sealight test session"
        }
    fi

    log_success "Sealight test reporting initialized"
}

finalize_sealight_reporting() {
    if ! check_sealight_enabled; then
        return 0
    fi

    log_info "Finalizing Sealight test reporting"

    # End test session
    if [[ -n "${SL_TOKEN}" ]] && command -v sl &>/dev/null; then
        sl end-test-session \
            --token "${SL_TOKEN}" \
            --test-stage "${SL_TEST_STAGE}" \
            --session-id "${SL_TEST_SESSION_ID}" || {
            log_warning "Failed to end Sealight test session"
        }
    fi

    # Generate coverage report
    generate_sealight_coverage_report

    log_success "Sealight test reporting finalized"
}

generate_sealight_coverage_report() {
    if ! check_sealight_enabled; then
        return 0
    fi

    log_info "Generating Sealight coverage report"

    local report_dir="${ARTIFACTS_DIR:-/tmp/artifacts}/sealight"
    mkdir -p "${report_dir}"

    # Generate report if Sealight CLI is available
    if command -v sl &>/dev/null && [[ -n "${SL_TOKEN}" ]]; then
        sl generate-report \
            --token "${SL_TOKEN}" \
            --test-stage "${SL_TEST_STAGE}" \
            --session-id "${SL_TEST_SESSION_ID}" \
            --output "${report_dir}/coverage-report.html" || {
            log_warning "Failed to generate Sealight coverage report"
        }
    fi

    # Save test metadata
    cat > "${report_dir}/test-metadata.json" <<EOF
{
  "test_stage": "${SL_TEST_STAGE}",
  "build_session_id": "${SL_BUILD_SESSION_ID:-}",
  "test_session_id": "${SL_TEST_SESSION_ID:-}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    log_success "Sealight reports saved to: ${report_dir}"
}

# ============================================================================
# EXPORT FUNCTIONS
# ============================================================================

export -f check_sealight_enabled setup_sealight_image_pull_secret
export -f configure_sealight_playwright setup_sealight_env_vars
export -f get_sealight_helm_params initialize_sealight_reporting
export -f finalize_sealight_reporting generate_sealight_coverage_report