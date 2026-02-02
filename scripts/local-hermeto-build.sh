#!/bin/bash
#
# Copyright Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# This script simulates the Konflux build process locally using Hermeto.
# It can either build the dependency cache or build a container image.
set -ex
set -uo pipefail

#######################################
# Constants
#######################################
readonly LOCAL_CACHE_BASEDIR='./hermeto-cache/'
readonly HERMETO_IMAGE='quay.io/konflux-ci/hermeto:latest'

# Target platform for cross-builds (e.g., linux/arm64, linux/amd64)
# Set via environment variable or defaults to native platform
TARGET_PLATFORM="${TARGET_PLATFORM:-}"

#######################################
# Normalizes architecture names to Linux conventions used by RPM repos.
# Globals:
#   None
# Arguments:
#   arch: Architecture name to normalize
# Outputs:
#   The normalized architecture name (e.g., aarch64, x86_64)
#######################################
normalize_arch() {
  local arch="$1"
  case "${arch}" in
    arm64)  echo "aarch64" ;;  # macOS/docker uses arm64, Linux RPMs use aarch64
    amd64)  echo "x86_64" ;;   # docker uses amd64, Linux uses x86_64
    *)      echo "${arch}" ;;  # Pass through (x86_64, aarch64, etc.)
  esac
}

#######################################
# Derives the architecture name from TARGET_PLATFORM.
# Falls back to native architecture if TARGET_PLATFORM is not set.
# Globals:
#   TARGET_PLATFORM
# Arguments:
#   None
# Outputs:
#   The architecture name (e.g., aarch64, x86_64)
#######################################
get_target_arch() {
  if [[ -z "${TARGET_PLATFORM}" ]]; then
    # Native architecture - normalize for macOS (arm64 -> aarch64)
    normalize_arch "$(uname -m)"
    return
  fi

  local platform_arch="${TARGET_PLATFORM#*/}"  # Extract arch from linux/arch
  normalize_arch "${platform_arch}"
}

TARGET_ARCH="$(get_target_arch)"

#######################################
# Prints usage information and exits.
# Globals:
#   None
# Arguments:
#   None
#######################################
usage() {
  cat << EOF
This script tries to somewhat simulate the Konflux build process.

Usage: $0 <type> <directory> [image]

The examples below assume you are in the root of the repository.
Examples:
  $0 cache .
  $0 image . quay.io/example/image:tag

Cross-platform build example (ARM on x86), this requires `qemu-user-static` to be installed:
  TARGET_PLATFORM=linux/arm64 $0 cache .
  TARGET_PLATFORM=linux/arm64 $0 image . quay.io/example/image:tag

Options:
  <type>      The type of build. Options are:
                  - cache: Build the cache using Hermeto
                  - image: Build the image
  <directory> The directory of the component to build.
  [image]     The name of the container image to build. Required for 'image' type.

Environment variables:
  TARGET_PLATFORM  Target platform for podman (e.g., linux/arm64, linux/amd64).
                   If not set, builds for the native platform.
                   The architecture (aarch64, x86_64) is automatically derived.

Note: after using 'cache', you may want to revert any changes done to the 'python/requirements*.txt' files before running 'cache' again.
EOF
  exit 1
}

#######################################
# Check for GNU sed on macOS
#######################################
check_gnu_sed() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! sed --version 2>/dev/null | grep -q "GNU sed"; then
      echo "Error: GNU sed is required on macOS." >&2
      echo "Install it with: brew install gnu-sed" >&2
      echo "Then add to your PATH: export PATH=\"\$(brew --prefix)/opt/gnu-sed/libexec/gnubin:\$PATH\"" >&2
      exit 1
    fi
  fi
}

#######################################
# Transforms a Containerfile to inject Hermeto/cachi2 configuration.
# Globals:
#   None
# Arguments:
#   containerfile: Path to the original Containerfile
#   transformed_containerfile: Path to write the transformed Containerfile
#######################################
transform_containerfile() {
  local containerfile="$1"
  local transformed_containerfile="$2"

  cp "${containerfile}" "${transformed_containerfile}"

  # Configure dnf to use the cachi2 repo
  # Use TARGET_ARCH for cross-platform builds instead of $(uname -m)
  sed -i "/RUN *\(dnf\|microdnf\) install/i RUN rm -r /etc/yum.repos.d/* && cp /cachi2/output/deps/rpm/${TARGET_ARCH}/repos.d/hermeto.repo /etc/yum.repos.d/" \
    "${transformed_containerfile}"

  # inject the cachi2 env variables to every RUN command
  sed -i 's/^\s*RUN /RUN . \/cachi2\/cachi2.env \&\& /' $transformed_containerfile
}

#######################################
# Builds the dependency cache using Hermeto.
# Globals:
#   HERMETO_IMAGE
#   TARGET_PLATFORM
#   TARGET_ARCH
# Arguments:
#   local_cache_dir: Path to the local cache directory
#   local_cache_output_dir: Path to the cache output directory
#######################################
build_cache() {
  local local_cache_dir="$1"
  local local_cache_output_dir="$2"
  local platform_args=()

  # Set platform args if TARGET_PLATFORM is specified
  if [[ -n "${TARGET_PLATFORM}" ]]; then
    platform_args=(--platform "${TARGET_PLATFORM}")
    echo "Building cache for platform: ${TARGET_PLATFORM} (arch: ${TARGET_ARCH})"
  fi

  # Ensure the local cache dir exists
  mkdir -p "${local_cache_output_dir}"

  # Ensure the latest hermeto image
  podman pull "${platform_args[@]}" "${HERMETO_IMAGE}"

  # Build cache
  podman run --rm -ti \
    "${platform_args[@]}" \
    -v "${PWD}:/source:z" \
    -v "${local_cache_dir}:/cachi2:z" \
    -w /source \
    "${HERMETO_IMAGE}" \
    --log-level DEBUG \
    fetch-deps --dev-package-managers \
    --source . \
    --output /cachi2/output \
    '[{"type": "rpm", "path": "."}, {"type": "yarn","path": "."}, {"type": "yarn","path": "./dynamic-plugins"}, {"type": "pip","path": "./python", "allow_binary": "false"}]'

  podman run --rm -ti \
    "${platform_args[@]}" \
    -v "${PWD}:/source:z" \
    -v "${local_cache_dir}:/cachi2:z" \
    -w /source \
    "${HERMETO_IMAGE}" \
    generate-env --format env --output /cachi2/cachi2.env /cachi2/output

  podman run --rm -ti \
    "${platform_args[@]}" \
    -v "${PWD}:/source:z" \
    -v "${local_cache_dir}:/cachi2:z" \
    -w /source \
    "${HERMETO_IMAGE}" \
    inject-files /cachi2/output
  return 0
}

#######################################
# Builds a container image using the hermeto cache.
# Globals:
#   TARGET_PLATFORM
#   TARGET_ARCH
# Arguments:
#   component_dir: Path to the component directory
#   local_cache_dir: Path to the local cache directory
#   image: Name of the container image to build
#######################################
build_image() {
  local component_dir="$1"
  local local_cache_dir="$2"
  local image="$3"
  local platform_args=()

  # Set platform args if TARGET_PLATFORM is specified
  if [[ -n "${TARGET_PLATFORM}" ]]; then
    platform_args=(--platform "${TARGET_PLATFORM}")
    echo "Building image for platform: ${TARGET_PLATFORM} (arch: ${TARGET_ARCH})"
  fi

  # Ensure the local cache dir exists
  if [[ ! -d "${local_cache_dir}" ]]; then
    echo "Local cache dir does not exist. Please run the script with 'cache' first."
    echo "example: $0 cache ${component_dir}"
    exit 1
  fi

  # Transform the containerfile to simulate Konflux build
  transform_containerfile \
    "${component_dir}/docker/Containerfile" \
    "${component_dir}/docker/Containerfile.hermeto"

  # Prevent podman from injecting host RHEL subscriptions into the container.
  # Podman automatically mounts host subscription secrets (/run/secrets/redhat.repo,
  # /run/secrets/rhsm, /run/secrets/etc-pki-entitlement) which enables RHEL repos
  # not in the hermeto cache. With --network none, dnf/microdnf fails trying to
  # access these repos. Mount empty paths over these secrets to block injection.
  local empty_dir
  empty_dir=$(mktemp -d)
  trap "rm -rf ${empty_dir}" EXIT

  podman build -t "${image}" \
    "${platform_args[@]}" \
    --network none \
    --no-cache \
    -f "${component_dir}/docker/Containerfile.hermeto" \
    -v "${local_cache_dir}:/cachi2" \
    -v /dev/null:/run/secrets/redhat.repo \
    -v "${empty_dir}:/run/secrets/rhsm:z" \
    -v "${empty_dir}:/run/secrets/etc-pki-entitlement:z" \
    "${component_dir}"
}

#######################################
# Main entry point for the script.
# Globals:
#   LOCAL_CACHE_BASEDIR
# Arguments:
#   Command line arguments
#######################################
main() {
  check_gnu_sed
  
  if [[ $# -lt 2 ]]; then
    usage
  fi

  local type="$1"
  local component_dir="$2"
  local image="${3:-}"

  # Check if the type is valid
  if [[ "${type}" != "cache" && "${type}" != "image" ]]; then
    echo "Invalid type: ${type}"
    usage
  fi

  # Check if image is provided for the 'image' type
  if [[ "${type}" == "image" && -z "${image}" ]]; then
    echo "Image name is required for the 'image' type."
    usage
  fi

  mkdir -p "${LOCAL_CACHE_BASEDIR}"
  # Resolve paths
  local resolved_component_dir="$(realpath "${component_dir}")"
  local local_cache_dir="$(realpath "${LOCAL_CACHE_BASEDIR}")/$(basename "${resolved_component_dir}")"
  local local_cache_output_dir="${local_cache_dir}/output"

  echo "Component dir: ${resolved_component_dir}"
  echo "Local cache dir: ${local_cache_dir}"

  case "${type}" in
    cache)
      build_cache "${local_cache_dir}" "${local_cache_output_dir}"
      ;;
    image)
      build_image "${resolved_component_dir}" "${local_cache_dir}" "${image}"
      ;;
  esac
}

main "$@"
