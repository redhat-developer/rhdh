#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_PROFILE="${SCRIPT_DIR}/e2e-secrets.profile.json"
LOCAL_TEST_ARGS=("$@")

# shellcheck source=e2e-tests/local-secrets.sh
source "${SCRIPT_DIR}/local-secrets.sh"
# shellcheck source=.ci/pipelines/lib/secrets.sh
source "${SCRIPT_DIR}/../.ci/pipelines/lib/secrets.sh"

usage() {
  cat << 'EOF'
Usage: BASE_URL=<url> ./local-test.sh -- --project=<project> [PLAYWRIGHT_OPTIONS]

Run Playwright directly on the host against an existing RHDH deployment.
Cluster-aware tests also require K8S_CLUSTER_URL and K8S_CLUSTER_TOKEN.

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

PROJECT_SELECTED=false
for ((argument_index = 0; argument_index < ${#PLAYWRIGHT_ARGS[@]}; argument_index++)); do
  case "${PLAYWRIGHT_ARGS[argument_index]}" in
    --project=*)
      [[ -n "${PLAYWRIGHT_ARGS[argument_index]#--project=}" ]] && PROJECT_SELECTED=true
      ;;
    --project)
      if ((argument_index + 1 < ${#PLAYWRIGHT_ARGS[@]})) \
        && [[ "${PLAYWRIGHT_ARGS[argument_index + 1]}" != -* ]]; then
        PROJECT_SELECTED=true
      fi
      ;;
    *)
      ;;
  esac
done
if [[ "$PROJECT_SELECTED" != true ]]; then
  printf 'A Playwright project is required; pass --project=<project>.\n' >&2
  exit 2
fi

if [[ "${RHDH_LOCAL_TEST_SECRETS_WRAPPED:-}" != "1" ]]; then
  if [[ "${K8S_CLUSTER_URL+x}" == "x" ]]; then
    export RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_URL="$K8S_CLUSTER_URL"
  fi
  if [[ "${K8S_CLUSTER_TOKEN+x}" == "x" ]]; then
    export RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_TOKEN="$K8S_CLUSTER_TOKEN"
  fi
fi

local_secrets::reexec_with_stream "$SCRIPT_DIR" "$SECRET_PROFILE" \
  RHDH_LOCAL_TEST_SECRETS_WRAPPED "$0" "${LOCAL_TEST_ARGS[@]}" || exit 1

mkdir -p "${SCRIPT_DIR}/.local-test"
chmod 700 "${SCRIPT_DIR}/.local-test"
SECRET_RUNTIME_DIR=$(mktemp -d "${SCRIPT_DIR}/.local-test/secrets.XXXXXX")
trap 'rm -rf "$SECRET_RUNTIME_DIR"' EXIT
node "${SCRIPT_DIR}/decode-secret-stream.ts" "$SECRET_RUNTIME_DIR" <&3
exec 3<&-
secrets::load_directory "$SECRET_RUNTIME_DIR"
secrets::apply_common_aliases
export REDIS_USERNAME=temp
export REDIS_PASSWORD=test123

if [[ "${RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_URL+x}" == "x" ]]; then
  export K8S_CLUSTER_URL="$RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_URL"
fi
if [[ "${RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_TOKEN+x}" == "x" ]]; then
  export K8S_CLUSTER_TOKEN="$RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_TOKEN"
fi
unset RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_URL RHDH_LOCAL_TEST_CALLER_K8S_CLUSTER_TOKEN

secrets::prepare_database_certificates \
  "$SECRET_RUNTIME_DIR" "$SECRET_RUNTIME_DIR"
unset BW_SESSION BW_CLIENTID BW_CLIENTSECRET RHDH_E2E_SECRET_FD
unset rds_db_certificates_pem rds_db_certificates__dot__pem
unset azure_db_certificates_pem azure_db_certificates__dot__pem

cd "$SCRIPT_DIR"
yarn playwright test "${PLAYWRIGHT_ARGS[@]}"
