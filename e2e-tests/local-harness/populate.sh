#!/bin/bash
#
# Populates dynamic-plugins-root for the cluster-free E2E harness — the single
# source of truth for the populate step (CI, the docs, and the global-setup
# error message all point here).
#
# Installs a plugin set from the public OCI registry (quay.io) via
# install-dynamic-plugins + skopeo — no dynamic-plugins/dist source build and no
# cluster. Requires skopeo (preinstalled in CI; `brew install skopeo` on macOS).
#
# The optional first argument selects the install config (default: the curated
# harness set in e2e-tests/local-harness/dynamic-plugins.yaml). The plugin sanity
# check drives this hook through populate-catalog-index.sh.
#
# {{inherit}} tags resolve against the full dynamic-plugins.default.yaml — by
# default the repo-root file (same as Helm/CI `includes: dynamic-plugins.default.yaml`).
# Set CATALOG_INDEX_IMAGE to extract the full catalog DPDY from a catalog-index
# OCI image instead (same technique as production CATALOG_INDEX_IMAGE /
# update-dynamic-plugins-default.yaml).
set -e

# Pinned so local runs install the exact CLI version CI uses.
CLI_VERSION="0.4.0"

CONFIG_SRC="${1:-e2e-tests/local-harness/dynamic-plugins.yaml}"

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HARNESS_DIR}/../.." && pwd)"

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

# Extract dynamic-plugins.default.yaml from a catalog-index OCI image.
# Adapted from the overlays wiki unpack helper and
# .github/workflows/update-dynamic-plugins-default.yaml (skopeo, no podman).
extract_catalog_index_dpdy() {
  local image="$1"
  local dest="$2"
  local unpack_dir oci_dir

  unpack_dir="$(mktemp -d)"
  oci_dir="$(mktemp -d)"

  echo "======= Extracting dynamic-plugins.default.yaml from ${image}"
  skopeo copy "docker://${image}" "oci:${oci_dir}"
  for blob in "${oci_dir}"/blobs/sha256/*; do
    tar -xf "$blob" -C "${unpack_dir}/" 2>/dev/null || true
  done
  rm -rf "${oci_dir}"

  if [[ ! -f "${unpack_dir}/dynamic-plugins.default.yaml" ]]; then
    rm -rf "${unpack_dir}"
    echo "ERROR: ${image} does not contain dynamic-plugins.default.yaml at image root" >&2
    return 1
  fi

  mkdir -p "$(dirname "${dest}")"
  cp "${unpack_dir}/dynamic-plugins.default.yaml" "${dest}"
  rm -rf "${unpack_dir}"
  echo "======= Wrote ${dest}"
}

cd "$REPO_ROOT"

if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
  DPDY_INCLUDE="e2e-tests/local-harness/.generated/dynamic-plugins.default.yaml"
  mkdir -p "${HARNESS_DIR}/.generated"
  extract_catalog_index_dpdy "${CATALOG_INDEX_IMAGE}" "${REPO_ROOT}/${DPDY_INCLUDE}"
else
  if [[ ! -f "${REPO_ROOT}/dynamic-plugins.default.yaml" ]]; then
    echo "ERROR: ${REPO_ROOT}/dynamic-plugins.default.yaml not found." >&2
    echo "Run .github/workflows/update-dynamic-plugins-default.yaml or set CATALOG_INDEX_IMAGE." >&2
    exit 1
  fi
  echo "======= Using repo-root dynamic-plugins.default.yaml"
fi

mkdir -p dynamic-plugins-root
# The CLI hardcodes ./dynamic-plugins.yaml (cwd) as its config file; the copy at
# the repo root is gitignored.
cp "$CONFIG_SRC" dynamic-plugins.yaml

if [[ -n "${CATALOG_INDEX_IMAGE:-}" ]]; then
  sed -i "s|dynamic-plugins.default.yaml|${DPDY_INCLUDE}|" dynamic-plugins.yaml
fi

npx -y "@red-hat-developer-hub/cli-module-install-dynamic-plugins@$CLI_VERSION" install dynamic-plugins-root
