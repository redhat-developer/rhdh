#!/bin/bash
# Extract all OCI plugins from the catalog index using install-dynamic-plugins.py
# Usage: ./extract-plugins.sh [VERSION]
#
# Prerequisites: skopeo, python3 with pyyaml
#
# This script:
# 1. Extracts the catalog index to get dynamic-plugins.default.yaml
# 2. Generates an override YAML that enables all OCI plugins and disables local ones
# 3. Runs install-dynamic-plugins.py to download and extract all OCI plugin packages
# 4. Generates a manifest.json for the test runner

set -euo pipefail

VERSION="${1:-1.10}"
CATALOG_INDEX_IMAGE="quay.io/rhdh/plugin-catalog-index:${VERSION}"
EXTRACT_DIR="${EXTRACT_DIR:-/tmp/rhdh-sanity-plugins}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
INSTALLER="${REPO_ROOT}/scripts/install-dynamic-plugins/install-dynamic-plugins.py"

echo "==> Catalog index: ${CATALOG_INDEX_IMAGE}"
echo "==> Output: ${EXTRACT_DIR}"
echo "==> Installer: ${INSTALLER}"

# Check prerequisites
for cmd in skopeo python3; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is required but not installed."
    exit 1
  fi
done

if [ ! -f "$INSTALLER" ]; then
  echo "ERROR: install-dynamic-plugins.py not found at ${INSTALLER}"
  exit 1
fi

# Clean and prepare
rm -rf "${EXTRACT_DIR}"
mkdir -p "${EXTRACT_DIR}"

# Step 1: Extract catalog index YAML directly with skopeo
echo "==> Downloading catalog index image..."
CATALOG_DIR="${EXTRACT_DIR}/.catalog-index"
mkdir -p "${CATALOG_DIR}" "${EXTRACT_DIR}/.catalog-content"

skopeo copy --override-os=linux --override-arch=amd64 \
  "docker://${CATALOG_INDEX_IMAGE}" "dir:${CATALOG_DIR}"

echo "==> Extracting catalog index layers..."
for layer_digest in $(jq -r '.layers[].digest' "${CATALOG_DIR}/manifest.json" | sed 's/sha256://'); do
  tar -xf "${CATALOG_DIR}/${layer_digest}" -C "${EXTRACT_DIR}/.catalog-content/" 2>/dev/null || true
done

DPDY="${EXTRACT_DIR}/.catalog-content/dynamic-plugins.default.yaml"
if [ ! -f "$DPDY" ]; then
  echo "ERROR: dynamic-plugins.default.yaml not found in catalog index"
  exit 1
fi
echo "==> Found dynamic-plugins.default.yaml ($(wc -l < "$DPDY") lines)"

# Step 2: Generate override that enables all OCI plugins, disables local ones
echo "==> Generating plugin override config..."
python3 - "${EXTRACT_DIR}" "${DPDY}" << 'PYEOF'
import sys, yaml, os

extract_dir = sys.argv[1]
dpdy_path = sys.argv[2]

with open(dpdy_path) as f:
    data = yaml.safe_load(f)

overrides = []
for p in data["plugins"]:
    pkg = p["package"]
    if pkg.startswith("./"):
        overrides.append({"package": pkg, "disabled": True})
    elif pkg.startswith("oci://") and p.get("disabled", False):
        overrides.append({"package": pkg, "disabled": False})

result = {
    "includes": ["dynamic-plugins.default.yaml"],
    "plugins": overrides,
}

out_path = os.path.join(extract_dir, "dynamic-plugins.yaml")
with open(out_path, "w") as f:
    yaml.safe_dump(result, f, default_flow_style=False)

enabled_oci = sum(1 for o in overrides if not o["disabled"])
disabled_local = sum(1 for o in overrides if o["disabled"])
print(f"  Enabled OCI: {enabled_oci}, Disabled local: {disabled_local}")
PYEOF

# Step 3: Copy DPDY into extract dir so the installer can find it via includes
cp "${DPDY}" "${EXTRACT_DIR}/dynamic-plugins.default.yaml"

# Step 4: Run install-dynamic-plugins.py to download all OCI plugin packages
# The installer reads dynamic-plugins.yaml from cwd, so cd into EXTRACT_DIR
echo "==> Installing OCI plugins (this may take a few minutes)..."
(cd "${EXTRACT_DIR}" && \
SKIP_INTEGRITY_CHECK=true \
python3 "${INSTALLER}" "${EXTRACT_DIR}/") 2>&1 | grep -E "installed plugin|Skipping|Error" || true

# Step 5: Generate manifest.json for the test runner
echo "==> Generating manifest.json..."
python3 - "${EXTRACT_DIR}" << 'PYEOF'
import json, os, sys

extract_dir = sys.argv[1]
manifest = {"backend": [], "frontend": []}

for entry in sorted(os.listdir(extract_dir)):
    pkg_path = os.path.join(extract_dir, entry, "package.json")
    if not os.path.isfile(pkg_path):
        continue

    try:
        with open(pkg_path) as f:
            pkg = json.load(f)

        role = pkg.get("backstage", {}).get("role", "unknown")
        info = {
            "name": pkg.get("name", entry),
            "dirName": entry,
            "role": role,
            "version": pkg.get("version", "0.0.0"),
            "path": os.path.join(extract_dir, entry),
        }

        if "backend" in role:
            manifest["backend"].append(info)
        elif "frontend" in role:
            manifest["frontend"].append(info)
        else:
            print(f"  [unknown role] {entry}: {role}")
    except Exception as e:
        print(f"  [error] {entry}: {e}")

out_path = os.path.join(extract_dir, "manifest.json")
with open(out_path, "w") as f:
    json.dump(manifest, f, indent=2)

print(f"  Backend: {len(manifest['backend'])}, Frontend: {len(manifest['frontend'])}")
PYEOF

echo ""
echo "==> Done! Plugins extracted to ${EXTRACT_DIR}/"
echo "==> Run tests: cd sanity-plugin-check && npx jest --forceExit"
