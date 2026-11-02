#!/bin/bash
#
# Resolves the catalog index image for the cluster-free harness.
#
# `next` tracks main; release branches carry their own version tag.
#
# Usage:
#   ./e2e-tests/local-harness/resolve-catalog-index-image.sh [branch]
#
# Prints the resolved image reference on stdout.
set -euo pipefail

BRANCH="${1:-}"

if [[ "${BRANCH}" == release-* ]]; then
  echo "quay.io/rhdh/plugin-catalog-index:${BRANCH#release-}"
else
  echo "quay.io/rhdh/plugin-catalog-index:next"
fi
