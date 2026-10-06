#!/bin/bash
#
# Resolves the catalog index image for the cluster-free harness.
#
# `next` tracks main; release branches carry their own version tag. An optional
# override wins when set (validated so it cannot forge multi-line GITHUB_OUTPUT).
#
# Usage:
#   ./e2e-tests/local-harness/resolve-catalog-index-image.sh [branch] [override]
#
# Prints the resolved image reference on stdout.
set -euo pipefail

BRANCH="${1:-}"
OVERRIDE="${2:-}"

if [[ -n "${OVERRIDE}" ]]; then
  if [[ ! "${OVERRIDE}" =~ ^[A-Za-z0-9._/-]+(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$ ]]; then
    echo "invalid catalog_index_image: ${OVERRIDE}" >&2
    exit 1
  fi
  echo "${OVERRIDE}"
elif [[ "${BRANCH}" == release-* ]]; then
  echo "quay.io/rhdh/plugin-catalog-index:${BRANCH#release-}"
else
  echo "quay.io/rhdh/plugin-catalog-index:next"
fi
