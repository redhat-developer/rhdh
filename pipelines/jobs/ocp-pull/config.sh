#!/bin/bash
# OCP Pull job configuration

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Job-specific configuration can be overridden here
# These values are sourced after core/env.sh

# ============================================================================
# Namespace Configuration
# ============================================================================
# These values are already set in core/env.sh but can be overridden here if needed
# export NAME_SPACE="showcase"
# export NAME_SPACE_RBAC="showcase-rbac"
# export NAME_SPACE_POSTGRES_DB="postgress-external-db"

# ============================================================================
# Release Configuration
# ============================================================================
# export RELEASE_NAME="rhdh"
# export RELEASE_NAME_RBAC="rhdh-rbac"

# ============================================================================
# Helm Values Files
# ============================================================================
# export HELM_CHART_VALUE_FILE_NAME="showcase.yaml"
# export HELM_CHART_RBAC_VALUE_FILE_NAME="showcase-rbac.yaml"

# ============================================================================
# Test Projects to Run
# ============================================================================
# The yarn test projects to execute (defined in e2e-tests/package.json)
export TEST_PROJECT_BASE="showcase"
export TEST_PROJECT_RBAC="showcase-rbac"

# ============================================================================
# Timeout Configuration
# ============================================================================
# Maximum time to wait for deployments and services
export DEPLOYMENT_TIMEOUT_MINUTES=5
export DEPLOYMENT_CHECK_INTERVAL_SECONDS=10

# Maximum attempts to check if Backstage is running
export BACKSTAGE_MAX_ATTEMPTS=30
export BACKSTAGE_WAIT_SECONDS=30

# ============================================================================
# Job-Specific Features
# ============================================================================
# Enable or disable specific features for this job
# Orchestrator Feature Flags
export INSTALL_ORCHESTRATOR_INFRA=false     
export INSTALL_ORCHESTRATOR_PLUGINS=false   
export DEPLOY_ORCHESTRATOR_WORKFLOWS=false

export DEPLOY_TEST_CUSTOMIZATION_PROVIDER=true
export RUN_BASE_DEPLOYMENT=true
export RUN_RBAC_DEPLOYMENT=true

# ============================================================================
# Logging Configuration
# ============================================================================
# export LOGFILE="ocp-pull-test-log"

log_info "OCP Pull job configuration loaded"

