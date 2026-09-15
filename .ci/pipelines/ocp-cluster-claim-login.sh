#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_PROFILE="${SCRIPT_DIR}/../../e2e-tests/ephemeral-cluster-secrets.profile.json"

# shellcheck source=.ci/pipelines/lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"
# shellcheck source=e2e-tests/local-secrets.sh
source "${SCRIPT_DIR}/../../e2e-tests/local-secrets.sh"
# shellcheck source=.ci/pipelines/lib/secrets.sh
source "${SCRIPT_DIR}/lib/secrets.sh"

# Check if prow log URL is provided as parameter, otherwise prompt for it
if [[ $# -eq 0 ]]; then
  read -p "Enter the prow log url: " input_url
else
  input_url="$1"
fi

# The stream decoder below requires Node, so validate it before secret setup.
for cmd in curl oc node; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    log::error "'$cmd' CLI not found. Please install it before running this script."
    exit 1
  fi
done

local_secrets::reexec_with_stream "${SCRIPT_DIR}/../../e2e-tests" \
  "$SECRET_PROFILE" RHDH_CLUSTER_CLAIM_SECRETS_WRAPPED "$0" "$input_url" || exit 1
SECRET_RUNTIME_DIR=$(mktemp -d "${TMPDIR:-.}/rhdh-cluster-claim-secrets.XXXXXX")
trap 'rm -rf "$SECRET_RUNTIME_DIR"' EXIT
node "${SCRIPT_DIR}/../../e2e-tests/decode-secret-stream.mjs" \
  "$SECRET_RUNTIME_DIR" <&3
exec 3<&-
secrets::load_directory "$SECRET_RUNTIME_DIR"
unset RHDH_E2E_SECRET_FD BW_SESSION BW_CLIENTID BW_CLIENTSECRET

id=$(echo "$input_url" | awk -F'/' '{print $NF}')
job=$(echo "$input_url" | awk -F'/' '{print $(NF-1)}')

build_log_url="https://prow.ci.openshift.org/log?container=test&id=${id}&job=${job}"
namespace=$(curl -s "$build_log_url" | grep "The claimed cluster" | sed -E 's/.*The claimed cluster ([^.]+)\ is ready after.*/\1/' || true)

log::info "Prow build log URL: $build_log_url"
log::info "Ephemeral cluster namespace: $namespace"

if [[ -z "$namespace" ]]; then
  log::error "Cluster claim not found. Please provide a valid prow url that uses cluster claim."
  exit 1
elif [[ ! "$namespace" =~ ^rhdh-[0-9]+-[0-9]+-us-east-2 ]]; then
  log::error "Namespace must match pattern 'rhdh-[version]-us-east-2'."
  exit 1
fi

# ── Bitwarden credentials ─────────────────────────────────────────────────────

CLUSTER_ADMIN_USERNAME=${EPHEMERAL_CLUSTER_ADMIN_USERNAME:-}
CLUSTER_ADMIN_PASSWORD=${EPHEMERAL_CLUSTER_ADMIN_PASSWORD:-}
unset EPHEMERAL_CLUSTER_ADMIN_USERNAME EPHEMERAL_CLUSTER_ADMIN_PASSWORD

if [[ -z "$CLUSTER_ADMIN_USERNAME" ]]; then
  log::error "EPHEMERAL_CLUSTER_ADMIN_USERNAME not found in Bitwarden profile"
  exit 1
fi
if [[ -z "$CLUSTER_ADMIN_PASSWORD" ]]; then
  log::error "EPHEMERAL_CLUSTER_ADMIN_PASSWORD not found in Bitwarden profile"
  exit 1
fi

# ── Log in to the ephemeral cluster ──────────────────────────────────────────

cluster_api="https://api.${namespace}.rhdh-qe.devcluster.openshift.com:6443"
log::info "Logging in to cluster: $cluster_api"

if ! oc login "$cluster_api" --username "$CLUSTER_ADMIN_USERNAME" --password "$CLUSTER_ADMIN_PASSWORD" --insecure-skip-tls-verify=true; then
  log::error "Login failed. The cluster may be expired or the HTPasswd identity provider is not configured."
  log::info "To enable cluster login for investigation:"
  log::info "  1. Add [debug] to your PR title  →  e.g. 'fix: my change [debug]'"
  log::info "  2. Re-trigger the CI job         →  /test e2e-ocp-helm"
  log::info "  3. Re-run this script with the new job's prow URL"
  exit 1
fi

# ── Web console ───────────────────────────────────────────────────────────────

read -p "Do you want to open the OpenShift web console? (y/n): " open_console

if [[ "$open_console" == "y" || "$open_console" == "Y" ]]; then

  console_url="https://console-openshift-console.apps.${namespace}.rhdh-qe.devcluster.openshift.com/dashboards"

  log::info "Opening web console at $console_url..."
  log::info "Use below user and password to login into web console:"
  log::info "Username: $CLUSTER_ADMIN_USERNAME"
  if command -v pbcopy &> /dev/null; then
    echo "$CLUSTER_ADMIN_PASSWORD" | pbcopy
    log::success "Password copied to clipboard"
  elif command -v xclip &> /dev/null; then
    echo "$CLUSTER_ADMIN_PASSWORD" | xclip -selection clipboard
    log::success "Password copied to clipboard"
  elif command -v wl-copy &> /dev/null; then
    echo "$CLUSTER_ADMIN_PASSWORD" | wl-copy
    log::success "Password copied to clipboard"
  else
    log::warn "No clipboard utility found (install pbcopy/xclip/wl-copy to enable)"
  fi
  sleep 3

  if command -v xdg-open &> /dev/null; then
    xdg-open "$console_url"
  elif command -v open &> /dev/null; then
    open "$console_url"
  else
    log::warn "Unable to detect a browser. Please open the following URL manually:"
    log::info "$console_url"
  fi
else
  log::info "Web console not opened."
fi
