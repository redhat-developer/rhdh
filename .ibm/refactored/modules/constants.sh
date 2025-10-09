#!/usr/bin/env bash
#
# Global Constants Module - Centralized configuration values
#

# Guard to prevent multiple sourcing
if [[ -n "${_CONSTANTS_LOADED:-}" ]]; then
    return 0
fi
readonly _CONSTANTS_LOADED=true

# ============================================================================
# TIMEOUT CONSTANTS
# ============================================================================

# Deployment timeouts (in seconds)
readonly TIMEOUT_DEPLOYMENT_DEFAULT=300
readonly TIMEOUT_DEPLOYMENT_LONG=1200
readonly TIMEOUT_HELM_INSTALL=1200
readonly TIMEOUT_OPERATOR_INSTALL=600

# Resource readiness timeouts
readonly TIMEOUT_NAMESPACE_READY=30
readonly TIMEOUT_POD_READY=300
readonly TIMEOUT_SERVICE_READY=120
readonly TIMEOUT_REDIS_READY=120

# Job completion timeouts
readonly TIMEOUT_JOB_COMPLETION=180
readonly TIMEOUT_BUILD_COMPLETE=600

# Health check timeouts
readonly TIMEOUT_HEALTH_CHECK=30
readonly TIMEOUT_HEALTH_CHECK_CONNECT=10

# ============================================================================
# RETRY CONSTANTS
# ============================================================================

# Retry attempts
readonly RETRY_DEFAULT=3
readonly RETRY_HEALTH_CHECK=5
readonly RETRY_DEPLOYMENT_RECOVERY=2
readonly RETRY_APPLY_RESOURCE=3
readonly RETRY_REDIS_CHECK=30

# Retry delays (in seconds)
readonly RETRY_DELAY_DEFAULT=5
readonly RETRY_DELAY_HEALTH_CHECK=10
readonly RETRY_DELAY_DEPLOYMENT=30
readonly RETRY_DELAY_REDIS=5

# ============================================================================
# RESOURCE LIMITS
# ============================================================================

# Resource request/limits
readonly REDIS_MEMORY_REQUEST="128Mi"
readonly REDIS_MEMORY_LIMIT="256Mi"
readonly REDIS_CPU_REQUEST="100m"
readonly REDIS_CPU_LIMIT="200m"

readonly POSTGRES_MEMORY_REQUEST="256Mi"
readonly POSTGRES_MEMORY_LIMIT="512Mi"
readonly POSTGRES_CPU_REQUEST="100m"
readonly POSTGRES_CPU_LIMIT="200m"

# ============================================================================
# DEPLOYMENT CONFIGURATION
# ============================================================================

# Service/Route naming
readonly DEPLOYMENT_FULLNAME_OVERRIDE="redhat-developer-hub"

# Helm chart configuration
readonly HELM_CHART_DEFAULT_MAJOR="1.7"
readonly HELM_REPO_UPDATE_INTERVAL=3600  # seconds

# ============================================================================
# HEALTH CHECK INTERVALS
# ============================================================================

readonly HEALTH_CHECK_INTERVAL=10
readonly DEPLOYMENT_CHECK_INTERVAL=10
readonly NAMESPACE_CHECK_INTERVAL=2
readonly REDIS_CHECK_INTERVAL=5

# ============================================================================
# CONSECUTIVE CHECKS FOR STABILITY
# ============================================================================

readonly REQUIRED_CONSECUTIVE_READY_CHECKS=3

# Export all constants (readonly variables are automatically inherited by subshells)

