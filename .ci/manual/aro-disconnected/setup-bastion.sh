#!/usr/bin/env bash
#
# Run on: BASTION HOST (inside Azure, via SSH).
# Prerequisites: API_SERVER and KUBEADMIN_PASSWORD supplied in the environment.
# Purpose: Install oc, Helm, Podman, Skopeo, opm, and umoci; enable the internal registry.
#

set -euo pipefail

if [[ -z "${API_SERVER:-}" || -z "${KUBEADMIN_PASSWORD:-}" ]]; then
  printf 'API_SERVER and KUBEADMIN_PASSWORD must be set in the environment.\n' >&2
  exit 1
fi

temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT

printf '%s\n' 'Installing oc on the bastion host'
wget \
  --quiet \
  --output-document "${temporary_directory}/openshift-client-linux.tar.gz" \
  https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/openshift-client-linux.tar.gz
mkdir -p "${temporary_directory}/openshift"
tar -xzf "${temporary_directory}/openshift-client-linux.tar.gz" -C "${temporary_directory}/openshift"
sudo install -m 0755 "${temporary_directory}/openshift/oc" /usr/local/bin/oc

printf '%s\n' 'Logging in to the cluster'
oc login "$API_SERVER" --username kubeadmin --password "$KUBEADMIN_PASSWORD"

printf '%s\n' 'Testing outbound connection from the cluster'
oc exec -it alertmanager-main-0 -n openshift-monitoring -- curl redhat.com

printf '%s\n' 'Enabling the internal registry'
oc patch config.imageregistry cluster \
  --namespace openshift-image-registry \
  --type merge \
  --patch '{"spec": {"defaultRoute": true}}'

printf '%s\n' 'Installing Helm'
curl -fsSL \
  --output "${temporary_directory}/get_helm.sh" \
  https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
bash "${temporary_directory}/get_helm.sh"

printf '%s\n' 'Installing Podman and Skopeo'
sudo dnf install --assumeyes podman skopeo

printf '%s\n' 'Installing opm'
wget \
  --quiet \
  --output-document "${temporary_directory}/opm-linux.tar.gz" \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/latest-4.19/opm-linux.tar.gz
mkdir -p "${temporary_directory}/opm"
tar -xzf "${temporary_directory}/opm-linux.tar.gz" -C "${temporary_directory}/opm"
sudo install -m 0755 "${temporary_directory}/opm/opm-rhel8" /usr/local/bin/opm

printf '%s\n' 'Installing umoci'
wget \
  --quiet \
  --output-document "${temporary_directory}/umoci.linux.amd64" \
  https://github.com/opencontainers/umoci/releases/download/v0.5.0/umoci.linux.amd64
sudo install -m 0755 "${temporary_directory}/umoci.linux.amd64" /usr/local/bin/umoci

printf '%s\n' 'Resizing /home and /tmp partitions'
sudo lvresize -r -L +9G /dev/mapper/rootvg-homelv
sudo lvresize -r -L +8G /dev/mapper/rootvg-tmplv
