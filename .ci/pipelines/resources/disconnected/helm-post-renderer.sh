#!/bin/bash
# Helm post-renderer for disconnected deployments.
#
# Patches the RHDH Deployment's pod spec for disconnected environments:
#   1. Mounts registries.conf so the init container resolves plugin images
#      from the mirror registry instead of the original registries.
#   2. Mounts a combined CA bundle (system CAs + mirror registry CA) so
#      skopeo can verify the mirror registry's TLS certificate.
#
# Using a post-renderer avoids the Helm "array clobber" pitfall:
# a values file that defines extraVolumes[] or initContainers[] replaces
# the chart's entire default array, losing any volumes added by newer
# chart versions. A post-renderer patches the already-rendered manifests
# so the chart's defaults are always preserved.
#
# Usage:  helm upgrade -i ... --post-renderer ./helm-post-renderer.sh

set -euo pipefail

yq eval '
  (select(.kind == "Deployment" and .metadata.name == "*-developer-hub") |
    .spec.template.spec.volumes += [
      {"name": "rhdh-plugin-mirror-conf", "configMap": {"name": "rhdh-plugin-mirror-conf"}},
      {"name": "mirror-registry-ca", "configMap": {"name": "mirror-registry-ca"}}
    ] |
    .spec.template.spec.initContainers[0].volumeMounts += [
      {"mountPath": "/etc/containers/registries.conf.d/rhdh-registries.conf", "name": "rhdh-plugin-mirror-conf", "readOnly": true, "subPath": "rhdh-registries.conf"},
      {"mountPath": "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", "name": "mirror-registry-ca", "readOnly": true, "subPath": "tls-ca-bundle.pem"}
    ]
  ) // .
'
