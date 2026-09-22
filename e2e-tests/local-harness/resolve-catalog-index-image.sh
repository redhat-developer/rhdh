#!/bin/bash
#
# Resolves the catalog index image for the cluster-free harness.
#
# `next` tracks main; release branches carry their own version tag. An optional
# override wins when set (validated so it cannot forge multi-line GITHUB_OUTPUT).
# With --pinned, the digest recorded in catalog-index.lock is used instead of the
# floating tag, so an index rebuilt upstream cannot change what a PR job tests.
#
# Usage:
#   ./e2e-tests/local-harness/resolve-catalog-index-image.sh [branch] [override] [--pinned]
#
# Prints the resolved image reference on stdout.
set -euo pipefail

BRANCH="${1:-}"
OVERRIDE="${2:-}"
PINNED="${3:-}"

if [[ -n "${PINNED}" && "${PINNED}" != "--pinned" ]]; then
  echo "unknown argument: ${PINNED} (expected --pinned)" >&2
  exit 1
fi

if [[ "${BRANCH}" == release-* ]]; then
  tag="${BRANCH#release-}"
else
  tag="next"
fi
image="quay.io/rhdh/plugin-catalog-index:${tag}"

if [[ -n "${OVERRIDE}" ]]; then
  if [[ ! "${OVERRIDE}" =~ ^[A-Za-z0-9._/-]+(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$ ]]; then
    echo "invalid catalog_index_image: ${OVERRIDE}" >&2
    exit 1
  fi
  echo "${OVERRIDE}"
  exit 0
fi

if [[ "${PINNED}" != "--pinned" ]]; then
  echo "${image}"
  exit 0
fi

lock="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/catalog-index.lock"
if [[ ! -r "${lock}" ]]; then
  echo "catalog index lock not found or unreadable: ${lock}" >&2
  exit 1
fi

# `|| true`: an all-comment lock file must reach the error below, not die on pipefail.
pin="$(grep -Ev '^[[:space:]]*(#|$)' "${lock}" | head -n 1 || true)"
if [[ ! "${pin}" =~ ^[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo "invalid pin in ${lock}: ${pin:-<empty>}" >&2
  exit 1
fi

# A release branch cut that forgets to retag the lock would silently keep
# testing the previous stream's index.
if [[ "${pin%@*}" != "${image}" ]]; then
  echo "pin in ${lock} is ${pin%@*}, but branch '${BRANCH}' resolves to ${image}" >&2
  exit 1
fi

echo "${pin}"
