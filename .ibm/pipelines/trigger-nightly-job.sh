#!/bin/bash
#
# Trigger RHDH nightly ProwJobs via the OpenShift CI REST API (Gangway).
#
# Prerequisites:
#   - oc CLI installed.
#   - curl and jq installed.
#
# Authentication:
#   The script uses a dedicated kubeconfig (~/.config/openshift-ci/kubeconfig)
#   to avoid interfering with your current cluster context.
#   If not logged in or the token is expired, the script will automatically
#   open a browser for SSO login via `oc login --web`.
#   See: https://docs.ci.openshift.org/how-tos/triggering-prowjobs-via-rest/
#
# Usage examples:
#   # Trigger the OCP Helm nightly job on the main branch:
#   ./trigger-nightly-job.sh --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly
#
#   # Trigger with a custom image (e.g. RC verification):
#   ./trigger-nightly-job.sh \
#     --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly \
#     --quay-repo rhdh/rhdh-hub-rhel9 \
#     --tag 1.9-123
#
#   # Trigger against a fork:
#   ./trigger-nightly-job.sh \
#     --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly \
#     --org my-github-org \
#     --repo my-rhdh-fork \
#     --branch release-1.9
#
#   # Dry-run mode (print the curl command without executing):
#   ./trigger-nightly-job.sh \
#     --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly \
#     --dry-run
#

set -o errexit
set -o nounset
set -o pipefail

# --- Constants ---
GANGWAY_URL="https://gangway-ci.apps.ci.l2s4.p1.openshiftapps.com/v1/executions"
CI_SERVER="https://api.ci.l2s4.p1.openshiftapps.com:6443"

# --- Logging ---
log::info() { echo "[INFO] $*" >&2; }
log::warn() { echo "[WARN] $*" >&2; }
log::error() { echo "[ERROR] $*" >&2; }

# --- Defaults ---
JOB_NAME=""
QUAY_REPO=""
TAG_NAME=""
GITHUB_ORG_NAME=""
GITHUB_REPOSITORY_NAME=""
RELEASE_BRANCH_NAME=""
SKIP_SEND_ALERT="true"
DRY_RUN=false

usage() {
  cat << EOF
Usage: $(basename "$0") -j JOB_NAME [OPTIONS]

Trigger an RHDH nightly ProwJob via the OpenShift CI Gangway REST API.

Required:
  -j, --job JOB_NAME           Full ProwJob name to trigger.

Optional overrides (passed as env var overrides to the job):
  -q, --quay-repo QUAY_REPO    Override the Quay repository (e.g. rhdh/rhdh-hub-rhel9).
  -t, --tag TAG_NAME           Override the image tag (e.g. 1.9-123). Requires -q.
  -o, --org GITHUB_ORG_NAME    Override the GitHub org (default in job: redhat-developer).
  -r, --repo GITHUB_REPO_NAME  Override the GitHub repo name (default in job: rhdh).
  -b, --branch BRANCH          Override the branch name.
  -S, --send-alerts            Send Slack alerts (default: alerts are skipped).

Other:
  -n, --dry-run                Dry-run mode: print the curl command without executing.
  -h, --help                   Show this help message.

Examples:
  # Basic trigger:
  $(basename "$0") --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly

  # Trigger with custom image:
  $(basename "$0") --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly --quay-repo rhdh/rhdh-hub-rhel9 --tag 1.9-123

  # Trigger against a fork, with Slack alerts enabled:
  $(basename "$0") --job periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly --org my-org --repo my-fork --branch release-1.9 --send-alerts

Job name pattern: periodic-ci-redhat-developer-rhdh-{BRANCH}-e2e-{PLATFORM}-{METHOD}-nightly
  Examples:
    periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly
    periodic-ci-redhat-developer-rhdh-main-e2e-ocp-operator-nightly
    periodic-ci-redhat-developer-rhdh-release-1.7-e2e-ocp-helm-nightly
  Full list: https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -j | --job)
        [[ $# -ge 2 ]] || {
          log::error "$1 requires an argument"
          exit 1
        }
        JOB_NAME="$2"
        shift 2
        ;;
      -q | --quay-repo)
        [[ $# -ge 2 ]] || {
          log::error "$1 requires an argument"
          exit 1
        }
        QUAY_REPO="$2"
        shift 2
        ;;
      -t | --tag)
        [[ $# -ge 2 ]] || {
          log::error "$1 requires an argument"
          exit 1
        }
        TAG_NAME="$2"
        shift 2
        ;;
      -o | --org)
        [[ $# -ge 2 ]] || {
          log::error "$1 requires an argument"
          exit 1
        }
        GITHUB_ORG_NAME="$2"
        shift 2
        ;;
      -r | --repo)
        [[ $# -ge 2 ]] || {
          log::error "$1 requires an argument"
          exit 1
        }
        GITHUB_REPOSITORY_NAME="$2"
        shift 2
        ;;
      -b | --branch)
        [[ $# -ge 2 ]] || {
          log::error "$1 requires an argument"
          exit 1
        }
        RELEASE_BRANCH_NAME="$2"
        shift 2
        ;;
      -S | --send-alerts)
        SKIP_SEND_ALERT="false"
        shift
        ;;
      -n | --dry-run)
        DRY_RUN=true
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        log::error "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
  done
}

validate_args() {
  if [[ -z "${JOB_NAME}" ]]; then
    log::error "-j/--job JOB_NAME is required."
    usage
    exit 1
  fi

  if [[ "${JOB_NAME}" != periodic-ci-* ]]; then
    log::error "Job name must start with 'periodic-ci-', got: ${JOB_NAME}"
    exit 1
  fi

  if [[ -n "${QUAY_REPO}" && -z "${TAG_NAME}" ]]; then
    log::error "--quay-repo requires --tag to be set."
    exit 1
  fi
}

build_payload() {
  local -a jq_args=()

  [[ -n "${QUAY_REPO}" ]] && jq_args+=(--arg MULTISTAGE_PARAM_OVERRIDE_QUAY_REPO "${QUAY_REPO}")
  [[ -n "${TAG_NAME}" ]] && jq_args+=(--arg MULTISTAGE_PARAM_OVERRIDE_TAG_NAME "${TAG_NAME}")
  [[ -n "${GITHUB_ORG_NAME}" ]] && jq_args+=(--arg MULTISTAGE_PARAM_OVERRIDE_GITHUB_ORG_NAME "${GITHUB_ORG_NAME}")
  [[ -n "${GITHUB_REPOSITORY_NAME}" ]] && jq_args+=(--arg MULTISTAGE_PARAM_OVERRIDE_GITHUB_REPOSITORY_NAME "${GITHUB_REPOSITORY_NAME}")
  [[ -n "${RELEASE_BRANCH_NAME}" ]] && jq_args+=(--arg MULTISTAGE_PARAM_OVERRIDE_RELEASE_BRANCH_NAME "${RELEASE_BRANCH_NAME}")
  jq_args+=(--arg MULTISTAGE_PARAM_OVERRIDE_SKIP_SEND_ALERT "${SKIP_SEND_ALERT}")

  jq -n --arg job "${JOB_NAME}" "${jq_args[@]}" \
    '{job_name: $job, job_execution_type: "1", pod_spec_options: {envs: ($ARGS.named | del(.job))}}'
}

ensure_auth() {
  if [[ "${DRY_RUN}" == true ]]; then
    echo "<TOKEN>"
    return
  fi

  local current_server
  current_server=$(oc whoami --show-server 2> /dev/null || true)
  local needs_login=false

  if [[ "${current_server}" != "${CI_SERVER}" ]]; then
    if [[ -n "${current_server}" ]]; then
      log::warn "Currently logged in to ${current_server}, need ${CI_SERVER}"
    fi
    needs_login=true
  elif ! oc whoami -t &> /dev/null; then
    log::warn "Token expired."
    needs_login=true
  fi

  if [[ "${needs_login}" == true ]]; then
    log::info "Logging in to OpenShift CI cluster..."
    if ! oc login --web "${CI_SERVER}"; then
      log::error "Login failed."
      exit 1
    fi
  fi

  if ! oc whoami -t 2> /dev/null; then
    log::error "Failed to get authentication token after login."
    exit 1
  fi
}

print_summary() {
  local payload="$1"
  log::info "Job:     ${JOB_NAME}"
  log::info "Payload:"
  echo "${payload}" | jq . 2> /dev/null || echo "${payload}"
  echo ""
}

print_dry_run() {
  local payload="$1"
  echo "[DRY RUN] Would execute:"
  echo "curl -s -X POST \\"
  echo "  -H \"Authorization: Bearer \$(oc whoami -t)\" \\"
  echo "  -H \"Content-Type: application/json\" \\"
  echo "  -d '${payload}' \\"
  echo "  ${GANGWAY_URL}"
}

trigger_job() {
  local token="$1"
  local payload="$2"

  log::info "Triggering job..."
  local response http_code
  response=$(curl -s -w "\n%{http_code}" -X POST \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "${token}") \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${GANGWAY_URL}")
  http_code="${response##*$'\n'}"
  response="${response%$'\n'*}"

  if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
    log::error "API returned HTTP ${http_code}"
    echo "${response}" | jq . >&2 2> /dev/null || echo "${response}" >&2
    log::error "The job name may be invalid. Verify at: https://prow.ci.openshift.org/configured-jobs/redhat-developer/rhdh"
    exit 1
  fi

  log::info "Response:"
  echo "${response}" | jq . >&2 2> /dev/null || echo "${response}" >&2

  echo "${response}"
}

poll_job_status() {
  local token="$1"
  local job_id="$2"

  echo ""
  log::info "Job ID: ${job_id}"
  log::info "Waiting for Prow URL..."

  local job_url="" status_response
  for _ in $(seq 1 5); do
    printf "."
    status_response=$(curl -s \
      -K <(printf 'header = "Authorization: Bearer %s"\n' "${token}") \
      "${GANGWAY_URL}/${job_id}" 2> /dev/null || true)

    if [[ -n "${status_response}" ]] && echo "${status_response}" | jq . &> /dev/null; then
      job_url=$(echo "${status_response}" | jq -r '.job_url // empty')
      [[ -n "${job_url}" ]] && break
    fi
    sleep 2
  done

  if [[ -n "${job_url}" ]]; then
    log::info "Job URL: ${job_url}"
  else
    log::warn "Job URL not yet available."
  fi

  log::info "Re-check status:"
  log::info "  curl -s -H \"Authorization: Bearer \$(oc whoami -t)\" ${GANGWAY_URL}/${job_id} | jq ."
}

main() {
  # Use a dedicated kubeconfig to avoid interfering with current cluster context.
  export KUBECONFIG="${XDG_CONFIG_HOME:-${HOME}/.config}/openshift-ci/kubeconfig"
  mkdir -p "$(dirname "${KUBECONFIG}")"

  parse_args "$@"
  validate_args

  local payload token
  payload=$(build_payload)
  token=$(ensure_auth)

  print_summary "${payload}"

  if [[ "${DRY_RUN}" == true ]]; then
    print_dry_run "${payload}"
    exit 0
  fi

  local response
  response=$(trigger_job "${token}" "${payload}")

  local job_id
  job_id=$(echo "${response}" | jq -r '.id // empty' 2> /dev/null || true)
  if [[ -n "${job_id}" ]]; then
    poll_job_status "${token}" "${job_id}"
  fi
}

main "$@"
