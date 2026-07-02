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
# Using a post-renderer avoids the Helm "array clobber" pitfall:
# a values file that defines extraVolumes[] or initContainers[] replaces
# the chart's entire default array, losing any volumes added by newer
# chart versions. A post-renderer patches the already-rendered manifests
# so the chart's defaults are always preserved.
#
# Usage:
#   helm upgrade -i ... \
#     --post-renderer ./helm-post-renderer.sh \
#     --post-renderer-args <mirror-registry-host:port>

set -euo pipefail

MIRROR_REGISTRY_URL="${1:?Usage: helm-post-renderer.sh <mirror-registry-url>}"

yq eval "
  (select(.kind == \"Deployment\" and .metadata.name == \"*-developer-hub\") |
    .spec.template.spec.volumes += [
      {\"name\": \"rhdh-plugin-mirror-conf\", \"configMap\": {\"name\": \"rhdh-plugin-mirror-conf\"}},
      {\"name\": \"mirror-registry-ca\", \"configMap\": {\"name\": \"mirror-registry-ca\"}}
    ] |
    .spec.template.spec.initContainers[0].volumeMounts += [
      {\"mountPath\": \"/etc/containers/registries.conf.d/rhdh-registries.conf\", \"name\": \"rhdh-plugin-mirror-conf\", \"readOnly\": true, \"subPath\": \"rhdh-registries.conf\"},
      {\"mountPath\": \"/etc/containers/policy.json\", \"name\": \"rhdh-plugin-mirror-conf\", \"readOnly\": true, \"subPath\": \"policy.json\"},
      {\"mountPath\": \"/etc/containers/certs.d/${MIRROR_REGISTRY_URL}/ca.crt\", \"name\": \"mirror-registry-ca\", \"readOnly\": true, \"subPath\": \"ca.crt\"}
    ]
  ) // .
"
