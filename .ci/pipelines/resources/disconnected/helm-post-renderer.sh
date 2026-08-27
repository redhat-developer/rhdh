#!/bin/bash
# Helm post-renderer for disconnected deployments.
#
# Patches the RHDH Deployment's pod spec for disconnected environments:
#   1. Mounts registries.conf so the init container resolves plugin images
#      from the mirror registry instead of the original registries.
#   2. Mounts the mirror registry CA at the standard container-tools
#      per-registry path (/etc/containers/certs.d/<registry>/ca.crt)
#      so skopeo trusts the mirror's TLS certificate.
#   3. Mounts a permissive policy.json so skopeo accepts unsigned images
#      from the mirror (Red Hat signature server is unreachable in
#      disconnected environments).
#
# The volumes/volumeMounts to inject live in helm-post-renderer-patch.yaml
# (rendered with envsubst for ${MIRROR_REGISTRY_URL}). They are appended to
# the rendered manifests with yq rather than supplied via a values file: a
# values file that defines extraVolumes[] or initContainers[] replaces the
# chart's entire default array, losing any volumes added by newer chart
# versions ("array clobber"). A post-renderer patches the already-rendered
# manifests so the chart's defaults are always preserved.
#
# Usage:
#   helm upgrade -i ... \
#     --post-renderer ./helm-post-renderer.sh \
#     --post-renderer-args <mirror-registry-host:port>

set -euo pipefail

MIRROR_REGISTRY_URL="${1:?Usage: helm-post-renderer.sh <mirror-registry-url>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_TEMPLATE="${SCRIPT_DIR}/helm-post-renderer-patch.yaml"

# Render the patch fragment with the mirror registry substituted in.
PATCH_YAML="$(MIRROR_REGISTRY_URL="${MIRROR_REGISTRY_URL}" envsubst < "${PATCH_TEMPLATE}")"

# Merge the fragment into the RHDH Deployment on stdin:
#   - volumes[]      += patch .volumes
#   - the install-dynamic-plugins initContainer's volumeMounts[] += patch .volumeMounts
#
# Note: mikefarah/yq's `==` treats "*" as a glob wildcard for strings (unlike
# jq's strict equality), so "*-developer-hub" intentionally matches the
# rhdh-chart's computed fullname (<release>-developer-hub).
# The initContainer is selected by name rather than index [0] so a future
# chart reorder (e.g. an additional initContainer inserted ahead of it)
# cannot silently misdirect the mount injection.
PATCH_YAML="${PATCH_YAML}" yq eval '
  (select(.kind == "Deployment" and .metadata.name == "*-developer-hub") |
    .spec.template.spec.volumes += (env(PATCH_YAML) | .volumes) |
    (.spec.template.spec.initContainers[] | select(.name == "install-dynamic-plugins")).volumeMounts
      += (env(PATCH_YAML) | .volumeMounts)
  ) // .
'
