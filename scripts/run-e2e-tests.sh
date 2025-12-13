#!/bin/bash
#
# Run e2e tests locally using rhdh-local
#
# This script:
# 1. Clones fresh rhdh-local if not present
# 2. Processes CI configs with local environment variables
# 3. Starts RHDH via podman/docker compose
# 4. Runs Playwright e2e tests
#
# Usage:
#   ./scripts/run-e2e-tests.sh [options]
#
# Options:
#   --profile <name>    Test profile: basic (default), rbac
#   --project <name>    Playwright project (default: showcase-sanity-plugins)
#   --build             Build local RHDH image from docker/Dockerfile
#   --image <url>       Use specific registry image
#   --fresh             Force re-clone rhdh-local
#   --skip-setup        Skip rhdh-local setup (use existing running instance)
#   --skip-teardown     Leave RHDH running after tests
#   --help              Show this help message

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Script directory and paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RHDH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RHDH_LOCAL_PATH="$RHDH_ROOT/rhdh-local"
RHDH_LOCAL_REPO="https://github.com/redhat-developer/rhdh-local.git"
CI_CONFIG_PATH="$RHDH_ROOT/.ibm/pipelines/resources/config_map"

# Default values
RHDH_IMAGE="${RHDH_IMAGE:-quay.io/rhdh-community/rhdh:next}"
TEST_PROFILE="basic"
TEST_PROJECT="showcase-sanity-plugins"
BUILD_LOCAL=false
FRESH_CLONE=false
SKIP_SETUP=false
SKIP_TEARDOWN=false

# Parse arguments
show_help() {
  head -30 "$0" | grep -E "^#" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
  --profile)
    TEST_PROFILE="$2"
    shift 2
    ;;
  --project)
    TEST_PROJECT="$2"
    shift 2
    ;;
  --build)
    BUILD_LOCAL=true
    shift
    ;;
  --image)
    RHDH_IMAGE="$2"
    shift 2
    ;;
  --fresh)
    FRESH_CLONE=true
    shift
    ;;
  --skip-setup)
    SKIP_SETUP=true
    shift
    ;;
  --skip-teardown)
    SKIP_TEARDOWN=true
    shift
    ;;
  --help | -h) show_help ;;
  *)
    log_warn "Unknown option: $1"
    shift
    ;;
  esac
done

# Detect container runtime
detect_container_runtime() {
  if command -v podman &>/dev/null; then
    echo "podman"
  elif command -v docker &>/dev/null; then
    echo "docker"
  else
    log_error "Neither podman nor docker found. Please install one."
    exit 1
  fi
}

CONTAINER_RUNTIME=$(detect_container_runtime)
log_info "Using container runtime: $CONTAINER_RUNTIME"

# Print configuration
log_info "============================================"
log_info "RHDH E2E Test Runner"
log_info "============================================"
log_info "Image:   $RHDH_IMAGE"
log_info "Profile: $TEST_PROFILE"
log_info "Project: $TEST_PROJECT"
log_info "E2E Path: $RHDH_ROOT/e2e-tests"
log_info "============================================"

# Clone rhdh-local if needed
clone_rhdh_local() {
  if [ "$FRESH_CLONE" = true ] && [ -d "$RHDH_LOCAL_PATH" ]; then
    log_info "Removing existing rhdh-local for fresh clone..."
    rm -rf "$RHDH_LOCAL_PATH"
  fi

  if [ ! -d "$RHDH_LOCAL_PATH" ]; then
    log_info "Cloning rhdh-local..."
    git clone --depth 1 "$RHDH_LOCAL_REPO" "$RHDH_LOCAL_PATH"
  else
    log_info "Using existing rhdh-local at: $RHDH_LOCAL_PATH"
  fi
}

# Setup configs for local testing
setup_configs() {
  log_info "Setting up local test configs..."

  # Local config files are in e2e-tests/local/
  LOCAL_CONFIG_DIR="$RHDH_ROOT/e2e-tests/local"

  # Select config file based on profile
  # We use minimal local configs that don't require external services
  case $TEST_PROFILE in
  basic)
    LOCAL_CONFIG_FILE="$LOCAL_CONFIG_DIR/config-basic.yaml"
    ;;
  rbac)
    LOCAL_CONFIG_FILE="$LOCAL_CONFIG_DIR/config-rbac.yaml"
    ;;
  *)
    log_error "Unknown profile: $TEST_PROFILE"
    exit 1
    ;;
  esac

  if [ ! -f "$LOCAL_CONFIG_FILE" ]; then
    log_error "Config file not found: $LOCAL_CONFIG_FILE"
    exit 1
  fi

  log_info "Using config: $LOCAL_CONFIG_FILE"

  # Create directories if needed
  mkdir -p "$RHDH_LOCAL_PATH/configs/app-config"
  mkdir -p "$RHDH_LOCAL_PATH/configs/rbac"

  # Copy local config to rhdh-local
  cp "$LOCAL_CONFIG_FILE" "$RHDH_LOCAL_PATH/configs/app-config/app-config.local.yaml"
  log_info "Created app-config.local.yaml"

  # Copy RBAC policy if using RBAC profile
  if [ "$TEST_PROFILE" = "rbac" ]; then
    if [ -f "$CI_CONFIG_PATH/rbac-policy.csv" ]; then
      cp "$CI_CONFIG_PATH/rbac-policy.csv" "$RHDH_LOCAL_PATH/configs/rbac/rbac-policy.csv"
      log_info "Copied rbac-policy.csv"
    fi
  fi
}

# Build local RHDH image
build_local_image() {
  if [ "$BUILD_LOCAL" = true ]; then
    log_info "Building local RHDH image..."
    $CONTAINER_RUNTIME build -f "$RHDH_ROOT/docker/Dockerfile" "$RHDH_ROOT" -t rhdh:local
    RHDH_IMAGE="localhost/rhdh:local"
    log_success "Built local image: $RHDH_IMAGE"
  fi
}

# Start rhdh-local
start_rhdh_local() {
  log_info "Starting rhdh-local with image: $RHDH_IMAGE"

  cd "$RHDH_LOCAL_PATH"
  RHDH_IMAGE="$RHDH_IMAGE" $CONTAINER_RUNTIME compose up -d

  # Wait for RHDH to be ready
  log_info "Waiting for RHDH to be ready..."
  HEALTH_URL="http://localhost:7007"
  MAX_WAIT=180
  ELAPSED=0

  # Give the container a moment to start the app
  sleep 10

  while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Try curl with explicit timeout and handle Windows/Git Bash quirks
    HTTP_CODE=$(curl --connect-timeout 5 --max-time 10 -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null)
    CURL_EXIT=$?

    # curl exit code 0 means success, check HTTP code
    if [ $CURL_EXIT -eq 0 ]; then
      if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
        log_success "RHDH is ready! (HTTP $HTTP_CODE after ${ELAPSED}s)"
        return 0
      fi
    fi

    sleep 5
    ELAPSED=$((ELAPSED + 5))
    log_info "Waiting for RHDH... (${ELAPSED}s elapsed, HTTP: $HTTP_CODE, curl exit: $CURL_EXIT)"
  done

  log_error "RHDH failed to start within ${MAX_WAIT}s"
  log_info "Container logs:"
  $CONTAINER_RUNTIME logs rhdh 2>&1 | tail -50
  exit 1
}

# Stop rhdh-local
stop_rhdh_local() {
  log_info "Stopping rhdh-local..."
  cd "$RHDH_LOCAL_PATH"
  $CONTAINER_RUNTIME compose down --volumes 2>/dev/null || true
}

# Run e2e tests
run_tests() {
  log_info "Running e2e tests..."
  log_info "Test project: $TEST_PROJECT"

  cd "$RHDH_ROOT/e2e-tests"

  # Install dependencies if needed
  if [ ! -d "node_modules" ]; then
    log_info "Installing e2e-tests dependencies..."
    yarn install
  fi

  # Run Playwright tests in CI mode (headless, no interactive prompts)
  log_info "Executing: CI=true BASE_URL=http://localhost:7007 yarn playwright test --project=$TEST_PROJECT"
  CI=true BASE_URL="http://localhost:7007" yarn playwright test --project="$TEST_PROJECT"

  TEST_EXIT_CODE=$?
  return $TEST_EXIT_CODE
}

# Cleanup on exit
cleanup() {
  if [ "$SKIP_TEARDOWN" = false ]; then
    stop_rhdh_local
  else
    log_info "Skipping teardown. RHDH is still running at http://localhost:7007"
  fi
}

# Main execution
main() {
  # Setup trap for cleanup
  trap cleanup EXIT

  if [ "$SKIP_SETUP" = false ]; then
    clone_rhdh_local
    setup_configs
    build_local_image
    start_rhdh_local
  else
    log_info "Skipping setup, using existing RHDH instance"
  fi

  run_tests
  TEST_EXIT_CODE=$?

  if [ $TEST_EXIT_CODE -eq 0 ]; then
    log_success "All tests passed!"
  else
    log_error "Some tests failed (exit code: $TEST_EXIT_CODE)"
  fi

  exit $TEST_EXIT_CODE
}

main
