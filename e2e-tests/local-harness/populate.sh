#!/bin/bash
#
# Populates dynamic-plugins-root for the cluster-free E2E harness — the single
# source of truth for the populate step (CI, the docs, and the global-setup
# error message all point here).
#
# Installs the plugin set from e2e-tests/local-harness/dynamic-plugins.yaml
# from the public OCI registry (ghcr) via install-dynamic-plugins + skopeo —
# no dynamic-plugins/dist source build and no cluster. Requires skopeo
# (Linux/CI; not available on macOS — see docs/e2e-tests/local-e2e-harness.md).
set -e

# Pinned so local runs install the exact CLI version CI uses.
CLI_VERSION="0.2.0"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

mkdir -p dynamic-plugins-root
# The CLI hardcodes ./dynamic-plugins.yaml (cwd) as its config file; the copy at
# the repo root is gitignored.
cp e2e-tests/local-harness/dynamic-plugins.yaml dynamic-plugins.yaml
npx -y "@red-hat-developer-hub/cli-module-install-dynamic-plugins@$CLI_VERSION" install dynamic-plugins-root
