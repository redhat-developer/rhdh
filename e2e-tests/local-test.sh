#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_PROFILE="${SCRIPT_DIR}/e2e-secrets.profile.json"

# shellcheck source=e2e-tests/local-secrets.sh
source "${SCRIPT_DIR}/local-secrets.sh"
# shellcheck source=e2e-tests/local-test-runtime.sh
source "${SCRIPT_DIR}/local-test-runtime.sh"

usage() {
  cat << 'EOF'
Usage: BASE_URL=<url> ./local-test.sh -- --project=<project> [PLAYWRIGHT_OPTIONS]

Run Playwright directly on the host against an existing RHDH deployment.
Cluster-aware tests also require K8S_CLUSTER_URL and K8S_CLUSTER_TOKEN.
Set NAME_SPACE for showcase projects, NAME_SPACE_RBAC for RBAC projects,
and NAME_SPACE_RUNTIME for showcase-runtime to the deployed namespace.

Examples:
  BASE_URL=https://backstage.example.com ./local-test.sh -- --project=showcase --headed
  BASE_URL=https://backstage.example.com ./local-test.sh -- --project=showcase-rbac playwright/e2e/rbac.spec.ts
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ "${1:-}" != "--" ]]; then
  printf 'Separate local-test options from Playwright arguments with --.\n' >&2
  usage >&2
  exit 2
fi
shift
PLAYWRIGHT_ARGS=("$@")

if [[ -z "${BASE_URL:-}" ]]; then
  printf 'BASE_URL is required and must identify an existing RHDH deployment.\n' >&2
  exit 2
fi

PLAYWRIGHT_PROJECTS=()
COLLECT_PROJECTS=false
for argument in "${PLAYWRIGHT_ARGS[@]}"; do
  case "$argument" in
    --project=*)
      if [[ -n "${argument#--project=}" ]]; then
        PLAYWRIGHT_PROJECTS+=("${argument#--project=}")
      fi
      COLLECT_PROJECTS=true
      ;;
    --project)
      COLLECT_PROJECTS=true
      ;;
    -*)
      COLLECT_PROJECTS=false
      ;;
    *)
      if [[ "$COLLECT_PROJECTS" == true ]]; then
        PLAYWRIGHT_PROJECTS+=("$argument")
      fi
      ;;
  esac
done
if [[ "${#PLAYWRIGHT_PROJECTS[@]}" -eq 0 ]]; then
  printf 'A Playwright project is required; pass --project=<project>.\n' >&2
  exit 2
fi

test_runtime::validate_namespaces "${PLAYWRIGHT_PROJECTS[@]}"
for variable in BASE_URL K8S_CLUSTER_URL K8S_CLUSTER_TOKEN NAME_SPACE NAME_SPACE_RBAC NAME_SPACE_RUNTIME; do
  if [[ "${!variable+x}" == "x" ]]; then
    export "RHDH_LOCAL_TEST_CALLER_${variable}=${!variable}"
  fi
done

cd "$SCRIPT_DIR"
local_secrets::exec_with_stream "$SCRIPT_DIR" "$SECRET_PROFILE" \
  node "$SCRIPT_DIR/local-test-secrets.ts" yarn playwright test "${PLAYWRIGHT_ARGS[@]}"
