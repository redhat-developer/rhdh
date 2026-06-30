#!/bin/bash
# Helm post-renderer for disconnected deployments.
#
# Appends the registries.conf ConfigMap volume and volumeMount to the
# RHDH Deployment's pod spec and install-dynamic-plugins init container.
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
    .spec.template.spec.volumes += [{"name": "rhdh-plugin-mirror-conf", "configMap": {"name": "rhdh-plugin-mirror-conf"}}] |
    .spec.template.spec.initContainers[0].volumeMounts += [{"mountPath": "/etc/containers/registries.conf.d/rhdh-registries.conf", "name": "rhdh-plugin-mirror-conf", "readOnly": true, "subPath": "rhdh-registries.conf"}]
  ) // .
'
