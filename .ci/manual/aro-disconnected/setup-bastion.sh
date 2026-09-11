#!/usr/bin/env bash
#
# Run on: BASTION HOST (inside Azure, via SSH).
# Prerequisites: API_SERVER, KUBEADMIN_PASSWORD, and OPENSHIFT_VERSION supplied in the environment.
# Purpose: Install oc, Helm, Podman, Skopeo, opm, and umoci; enable the internal registry.
#

set -euo pipefail

if [[ -z "${API_SERVER:-}" || -z "${KUBEADMIN_PASSWORD:-}" || -z "${OPENSHIFT_VERSION:-}" ]]; then
  printf 'API_SERVER, KUBEADMIN_PASSWORD, and OPENSHIFT_VERSION must be set in the environment.\n' >&2
  exit 1
fi

if [[ ! "$OPENSHIFT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'OPENSHIFT_VERSION must be a stable semantic version: %s\n' "$OPENSHIFT_VERSION" >&2
  exit 1
fi

HELM_VERSION="${HELM_VERSION:-3.18.6}"
UMOCI_VERSION="${UMOCI_VERSION:-0.5.0}"

if [[ ! "$HELM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'HELM_VERSION must be a stable semantic version: %s\n' "$HELM_VERSION" >&2
  exit 1
fi
if [[ ! "$UMOCI_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'UMOCI_VERSION must be a stable semantic version: %s\n' "$UMOCI_VERSION" >&2
  exit 1
fi

for command_name in curl sha256sum tar sudo; do
  if ! command -v "$command_name" > /dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command_name" >&2
    exit 1
  fi
done

verify_checksum() {
  local artifact_file="$1"
  local checksum_file="$2"
  local artifact_name="${artifact_file##*/}"
  local expected_checksum=''
  local checksum=''
  local checksum_name=''

  while read -r checksum checksum_name; do
    checksum_name="${checksum_name#\*}"
    if [[ "$checksum" =~ ^[[:xdigit:]]{64}$ ]] \
      && [[ -z "$checksum_name" || "$checksum_name" == "$artifact_name" ]]; then
      expected_checksum="$checksum"
      break
    fi
  done < "$checksum_file"

  if [[ -z "$expected_checksum" ]]; then
    printf 'No checksum found for %s in %s\n' "$artifact_name" "$checksum_file" >&2
    exit 1
  fi

  printf '%s  %s\n' "$expected_checksum" "$artifact_file" | sha256sum --check --status -
}

download_and_verify() {
  local artifact_url="$1"
  local checksum_url="$2"
  local artifact_file="$3"
  local checksum_file="${artifact_file}.sha256sum"

  curl -fsSL --output "$artifact_file" "$artifact_url"
  curl -fsSL --output "$checksum_file" "$checksum_url"
  verify_checksum "$artifact_file" "$checksum_file"
}

temporary_directory=$(mktemp -d)
trap 'rm -rf "$temporary_directory"' EXIT

printf '%s\n' 'Installing oc on the bastion host'
oc_archive="${temporary_directory}/openshift-client-linux-${OPENSHIFT_VERSION}.tar.gz"
download_and_verify \
  "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/${OPENSHIFT_VERSION}/openshift-client-linux-${OPENSHIFT_VERSION}.tar.gz" \
  "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/${OPENSHIFT_VERSION}/sha256sum.txt" \
  "$oc_archive"
mkdir -p "${temporary_directory}/openshift"
tar -xzf "$oc_archive" -C "${temporary_directory}/openshift"
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
helm_archive="${temporary_directory}/helm-v${HELM_VERSION}-linux-amd64.tar.gz"
download_and_verify \
  "https://get.helm.sh/helm-v${HELM_VERSION}-linux-amd64.tar.gz" \
  "https://get.helm.sh/helm-v${HELM_VERSION}-linux-amd64.tar.gz.sha256sum" \
  "$helm_archive"
mkdir -p "${temporary_directory}/helm"
tar -xzf "$helm_archive" -C "${temporary_directory}/helm"
sudo install -m 0755 "${temporary_directory}/helm/linux-amd64/helm" /usr/local/bin/helm

printf '%s\n' 'Installing Podman and Skopeo'
sudo dnf install --assumeyes podman skopeo

printf '%s\n' 'Installing opm'
opm_archive="${temporary_directory}/opm-linux-${OPENSHIFT_VERSION}.tar.gz"
download_and_verify \
  "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/${OPENSHIFT_VERSION}/opm-linux-${OPENSHIFT_VERSION}.tar.gz" \
  "https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/${OPENSHIFT_VERSION}/sha256sum.txt" \
  "$opm_archive"
mkdir -p "${temporary_directory}/opm"
tar -xzf "$opm_archive" -C "${temporary_directory}/opm"
sudo install -m 0755 "${temporary_directory}/opm/opm-rhel8" /usr/local/bin/opm

printf '%s\n' 'Installing umoci'
umoci_file="${temporary_directory}/umoci.linux.amd64"
download_and_verify \
  "https://github.com/opencontainers/umoci/releases/download/v${UMOCI_VERSION}/umoci.linux.amd64" \
  "https://github.com/opencontainers/umoci/releases/download/v${UMOCI_VERSION}/umoci.sha256sum" \
  "$umoci_file"
sudo install -m 0755 "$umoci_file" /usr/local/bin/umoci

printf '%s\n' 'Resizing /home and /tmp partitions'
sudo lvresize -r -L +9G /dev/mapper/rootvg-homelv
sudo lvresize -r -L +8G /dev/mapper/rootvg-tmplv
