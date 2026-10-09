#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRET_PROFILE="${SCRIPT_DIR}/../../e2e-tests/ephemeral-cluster-secrets.profile.json"

# shellcheck source=.ci/pipelines/lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"
# shellcheck source=e2e-tests/local-secrets.sh
source "${SCRIPT_DIR}/../../e2e-tests/local-secrets.sh"

input_url=''
console_mode=auto
for argument in "$@"; do
  case "$argument" in
    --open-console) console_mode=yes ;;
    --no-console) console_mode=no ;;
    --console=auto | --console=yes | --console=no) console_mode=${argument#*=} ;;
    -h | --help)
      printf 'Usage: %s [--open-console | --no-console] <Prow job URL>\n' "$0"
      exit 0
      ;;
    https://*)
      [[ -z "$input_url" ]] || {
        log::error "Provide only one Prow URL."
        exit 2
      }
      input_url=$argument
      ;;
    *)
      log::error "Unknown argument: $argument"
      exit 2
      ;;
  esac
done
if [[ -z "$input_url" ]]; then
  if [[ ! -t 0 ]]; then
    log::error "A Prow job URL is required when stdin is not a terminal."
    exit 2
  fi
  read -r -p "Enter the prow log url: " input_url
fi

if [[ ! "$input_url" =~ ^https://prow\.ci\.openshift\.org/view/gs/[^\?\#[:space:]]+/([A-Za-z0-9_.-]+)/([0-9]+)/?([\?\#].*)?$ ]]; then
  log::error "Expected a Prow job URL: https://prow.ci.openshift.org/view/gs/.../<job>/<build-id>"
  exit 2
fi
job=${BASH_REMATCH[1]}
id=${BASH_REMATCH[2]}

# The stream decoder below requires Node, so validate it before secret setup.
for cmd in curl oc node; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    log::error "'$cmd' CLI not found. Please install it before running this script."
    exit 1
  fi
done

if [[ "${RHDH_CLUSTER_CLAIM_SECRETS_WRAPPED:-}" != 1 ]]; then
  build_log_url="https://prow.ci.openshift.org/log?container=test&id=${id}&job=${job}"
  log::info "Prow build log URL: $build_log_url"
  if ! build_log=$(curl -fsS --connect-timeout 10 --max-time 60 --retry 2 "$build_log_url"); then
    log::error "Could not fetch the Prow build log (HTTP or network failure)."
    exit 1
  fi
  namespace=''
  while IFS= read -r line; do
    if [[ "$line" =~ The\ claimed\ cluster\ ([a-z0-9-]+)\ is\ ready\ after ]]; then
      if [[ -n "$namespace" && "$namespace" != "${BASH_REMATCH[1]}" ]]; then
        log::error "Multiple cluster claims found in the Prow build log."
        exit 1
      fi
      namespace=${BASH_REMATCH[1]}
    fi
  done <<< "$build_log"
  unset build_log
  if [[ -z "$namespace" ]]; then
    log::error "Cluster claim not found in this Prow build log."
    exit 1
  fi
  export RHDH_CLUSTER_CLAIM_NAMESPACE="$namespace"
fi
namespace=${RHDH_CLUSTER_CLAIM_NAMESPACE:-}
if [[ ! "$namespace" =~ ^rhdh-[0-9]+-[0-9]+-us-east-2$ ]]; then
  log::error "Namespace must match pattern 'rhdh-[version]-us-east-2'."
  exit 1
fi

local_secrets::reexec_with_stream "${SCRIPT_DIR}/../../e2e-tests" \
  "$SECRET_PROFILE" RHDH_CLUSTER_CLAIM_SECRETS_WRAPPED "$0" "$input_url" "--console=$console_mode" || exit 1
unset RHDH_CLUSTER_CLAIM_NAMESPACE
SECRET_RUNTIME_DIR=$(mktemp -d "${TMPDIR:-.}/rhdh-cluster-claim-secrets.XXXXXX")
trap 'rm -rf "$SECRET_RUNTIME_DIR"' EXIT
node "${SCRIPT_DIR}/../../e2e-tests/decode-secret-stream.ts" \
  "$SECRET_RUNTIME_DIR" <&3
exec 3<&-
unset RHDH_E2E_SECRET_FD BW_SESSION BW_CLIENTID BW_CLIENTSECRET

log::info "Ephemeral cluster namespace: $namespace"

# ── Bitwarden credentials ─────────────────────────────────────────────────────

CLUSTER_ADMIN_USERNAME=''
CLUSTER_ADMIN_PASSWORD=''
if [[ -f "$SECRET_RUNTIME_DIR/EPHEMERAL_CLUSTER_ADMIN_USERNAME" ]]; then
  IFS= read -r -d '' CLUSTER_ADMIN_USERNAME < "$SECRET_RUNTIME_DIR/EPHEMERAL_CLUSTER_ADMIN_USERNAME" || true
fi
if [[ -f "$SECRET_RUNTIME_DIR/EPHEMERAL_CLUSTER_ADMIN_PASSWORD" ]]; then
  IFS= read -r -d '' CLUSTER_ADMIN_PASSWORD < "$SECRET_RUNTIME_DIR/EPHEMERAL_CLUSTER_ADMIN_PASSWORD" || true
fi
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

open_console=$console_mode
if [[ "$console_mode" == auto ]]; then
  open_console=no
  if [[ -t 0 ]]; then
    read -r -p "Do you want to open the OpenShift web console? (y/n): " open_console || open_console=no
  fi
fi

if [[ "$open_console" == "y" || "$open_console" == "Y" || "$open_console" == yes ]]; then

  console_url="https://console-openshift-console.apps.${namespace}.rhdh-qe.devcluster.openshift.com/dashboards"

  log::info "Opening web console at $console_url..."
  log::info "Use below user and password to login into web console:"
  log::info "Username: $CLUSTER_ADMIN_USERNAME"
  if command -v pbcopy &> /dev/null; then
    if printf '%s' "$CLUSTER_ADMIN_PASSWORD" | pbcopy; then
      log::success "Password copied to clipboard"
    else
      log::warn "Unable to copy password to clipboard"
    fi
  elif command -v xclip &> /dev/null; then
    if printf '%s' "$CLUSTER_ADMIN_PASSWORD" | xclip -selection clipboard; then
      log::success "Password copied to clipboard"
    else
      log::warn "Unable to copy password to clipboard"
    fi
  elif command -v wl-copy &> /dev/null; then
    if printf '%s' "$CLUSTER_ADMIN_PASSWORD" | wl-copy; then
      log::success "Password copied to clipboard"
    else
      log::warn "Unable to copy password to clipboard"
    fi
  else
    log::warn "No clipboard utility found (install pbcopy/xclip/wl-copy to enable)"
  fi
  sleep 3

  if command -v xdg-open &> /dev/null; then
    xdg-open "$console_url" || log::warn "Unable to open browser; open $console_url manually."
  elif command -v open &> /dev/null; then
    open "$console_url" || log::warn "Unable to open browser; open $console_url manually."
  else
    log::warn "Unable to detect a browser. Please open the following URL manually:"
    log::info "$console_url"
  fi
else
  log::info "Web console not opened."
fi
