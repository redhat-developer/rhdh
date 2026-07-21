#!/bin/bash
#
# Prints every package ref declared by a catalog index image, one per line,
# with the documented known failures (plugin-sanity-excludes.txt) filtered out.
# Used by populate-catalog-index.sh to build the cluster-free install config.
#
# Output includes BOTH ref kinds the index declares:
#   - oci://registry/name[:tag|@sha256:...][!plugin-name]
#   - ./dynamic-plugins/dist/<name>  (plugins built into the product image;
#     the install CLI skips them outside the image, so they never reach the
#     cluster-free harness)
#
# Only real (uncommented) `- package:` entries count: the index also carries
# commented-out refs, and treating those as declarations would install
# packages the index does not declare.
#
# Requires skopeo and jq. Usage:
#   catalog-index-refs.sh quay.io/rhdh/plugin-catalog-index:next
set -e

IMAGE="${1:?usage: catalog-index-refs.sh <catalog-index-image>}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Extract dynamic-plugins.default.yaml from the catalog index OCI image.
# Layer blobs in a `skopeo copy ... dir:` layout are named by their bare sha256
# digest (no extension), so the layer list comes from manifest.json; tar
# auto-detects gzip-compressed layers. Platform overrides keep instance
# selection working on any host (multi-arch manifest lists otherwise fail on
# e.g. macOS).
skopeo copy --override-os linux --override-arch amd64 \
  "docker://${IMAGE}" "dir:${workdir}/idx" > /dev/null

# Layers are listed base-first, so the EFFECTIVE copy of the file is the one in
# the topmost layer that carries it (an index rebuilt as an overlay keeps a
# stale copy in a lower layer). Walk top-down and take the first hit.
default_yaml=""
for digest in $(jq -r '.layers | reverse | .[].digest' "${workdir}/idx/manifest.json"); do
  layer="${workdir}/idx/${digest#sha256:}"
  [[ -f "$layer" ]] || continue
  if content="$(tar -xOf "$layer" dynamic-plugins.default.yaml 2> /dev/null)" && [[ -n "$content" ]]; then
    default_yaml="$content"
    break
  fi
done

if [[ -z "$default_yaml" ]]; then
  echo "dynamic-plugins.default.yaml not found in ${IMAGE}" >&2
  exit 1
fi

# Known failures are extended-regex patterns, one per line. A missing excludes
# file must fail loudly: silently skipping the filter would install plugins
# documented as unable to boot, which aborts the whole backend and surfaces only
# as an opaque webServer timeout.
excludes_src="$DIR/plugin-sanity-excludes.txt"
if [[ ! -r "$excludes_src" ]]; then
  echo "excludes file not found or unreadable: ${excludes_src}" >&2
  exit 1
fi
# An all-comment file legitimately yields no patterns (grep exits 1).
grep -Ev '^[[:space:]]*(#|$)' "$excludes_src" > "$workdir/excludes.txt" || true

refs="$(
  echo "$default_yaml" \
    | grep -E '^[[:space:]]*-[[:space:]]+package:[[:space:]]*"?(oci://|\./dynamic-plugins/dist/)' \
    | sed -E 's/^[[:space:]]*-[[:space:]]+package:[[:space:]]*"?//; s/"[[:space:]]*$//' \
    | sort -u
)"

# grep -vEf with an empty pattern file is not portable; skip the filter instead.
if [[ -s "$workdir/excludes.txt" ]]; then
  echo "$refs" | grep -vEf "$workdir/excludes.txt" || true
else
  echo "$refs"
fi
