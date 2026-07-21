#!/bin/bash
#
# Populates dynamic-plugins-root for the cluster-free E2E harnesses — the single
# source of truth for the populate step (CI, the docs, and the global-setup
# error message all point here).
#
# Installs a plugin set from the public OCI registries via
# install-dynamic-plugins + skopeo — no dynamic-plugins/dist source build and no
# cluster. Requires skopeo (preinstalled in CI; `brew install skopeo` on macOS).
#
# The optional first argument selects the install config (default: the curated
# harness set used by the legacy-local E2E flow):
#
#   # curated harness set (legacy-local E2E)
#   ./e2e-tests/local-harness/populate.sh
#
#   # full catalog index set (plugin sanity check; generates the config)
#   CATALOG_INDEX_IMAGE=quay.io/rhdh/plugin-catalog-index:next \
#     ./e2e-tests/local-harness/populate-catalog-index.sh
set -e

# Pinned so local runs install the exact CLI version CI uses.
CLI_VERSION="0.2.0"

CONFIG_SRC="${1:-e2e-tests/local-harness/dynamic-plugins.yaml}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Resolve the config path against the CALLER's cwd before we cd to the repo
# root, so relative arguments from any directory keep working.
if [[ "${CONFIG_SRC#/}" == "$CONFIG_SRC" ]]; then
  if [[ -f "$CONFIG_SRC" ]]; then
    CONFIG_SRC="$(cd "$(dirname "$CONFIG_SRC")" && pwd)/$(basename "$CONFIG_SRC")"
  elif [[ ! -f "$REPO_ROOT/$CONFIG_SRC" ]]; then
    # Report the path the caller actually typed - resolving it against the repo
    # root first would fail later at `cp` with a path they never mentioned.
    echo "install config not found: ${CONFIG_SRC} (cwd: $(pwd))" >&2
    exit 1
  fi
fi

cd "$REPO_ROOT"

mkdir -p dynamic-plugins-root
# The CLI hardcodes ./dynamic-plugins.yaml (cwd) as its config file; the copy at
# the repo root is gitignored.
cp "$CONFIG_SRC" dynamic-plugins.yaml
npx -y "@red-hat-developer-hub/cli-module-install-dynamic-plugins@$CLI_VERSION" install dynamic-plugins-root
