#!/bin/bash -e
#
# Copyright (c) 2021-2025 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# this script will extract the filesystem of a container to a folder
# so you can browse its contents. Also works with scratch images

set -x

LOCAL_CACHE_BASEDIR=./hermeto-cache/
HERMETO_IMAGE=quay.io/konflux-ci/hermeto:latest


usage ()
{
  echo "This script tries to somewhat simulate the Konflux build process.

Usage: $0 <type> <directory> [image]

The examples below assume you are in the root of the repository.
Examples:
  $0 cache .
  $0 image . quay.io/example/image:tag

Options:
  <type>    The type of build. Options are:
                - cache: Build the cache using Hermeto
                - image: Build the image
  <directory> The directory of the component to build.
  [image]   The name of the container image to build. Required for the 'image' type.
  "
  exit
}

if [[ $# -lt 2 ]]; then usage; fi

TYPE=$1
COMPONENT_DIR=$2
IMAGE=$3

# Check if the type is valid
if [[ "$TYPE" != "cache" && "$TYPE" != "image" ]]; then
  echo "Invalid type: $TYPE"
  usage
fi

# Check if image is provided for the 'image' type
if [[ "$TYPE" == "image" && -z "$IMAGE" ]]; then
  echo "Image name is required for the 'image' type."
  usage
fi

function transformContainerfile() {
    local containerfile="$1"
    local transformed_containerfile="$2"

    cp $containerfile $transformed_containerfile

    # configure dnf to use the cachi2 repo
    sed -i '/RUN *\(dnf\|microdnf\) install/i RUN rm -r /etc/yum.repos.d/* && cp /cachi2/output/deps/rpm/$(uname -m)/repos.d/hermeto.repo /etc/yum.repos.d/' $transformed_containerfile

    # inject the cachi2 env variables to every RUN command
    sed -i 's/^\s*RUN /RUN . \/cachi2\/cachi2.env \&\& /' $transformed_containerfile
}

COMPONENT_DIR=$(realpath "$COMPONENT_DIR")
LOCAL_CACHE_DIR=$(realpath "$LOCAL_CACHE_BASEDIR")/$(basename "$COMPONENT_DIR")
LOCAL_CACHE_OUTPUT_DIR=$LOCAL_CACHE_DIR/output
echo "Component dir: $COMPONENT_DIR"
echo "Local cache dir: $LOCAL_CACHE_DIR"

#############
### CACHE ###
#############
if [[ "$TYPE" == "cache" ]]; then
  # ensure the local cache dir exists
  mkdir -p $LOCAL_CACHE_OUTPUT_DIR

  # ensure the latest hermeto image
  podman pull $HERMETO_IMAGE
  # build cache
  podman run --rm -ti -v "$PWD:/source:z" -v "$LOCAL_CACHE_DIR":/cachi2:z -w /source $HERMETO_IMAGE \
      --log-level DEBUG \
      fetch-deps --dev-package-managers  \
      --source . \
      --output /cachi2/output \
      '[{"type": "rpm", "path": "."}, {"type": "yarn","path": "."}, {"type": "yarn","path": "./dynamic-plugins"}, {"type": "pip","path": "./python", "allow_binary": "false"}]'

  podman run --rm -ti -v "$PWD:/source:z" -v "$LOCAL_CACHE_DIR":/cachi2:z -w /source $HERMETO_IMAGE \
    generate-env --format env --output /cachi2/cachi2.env /cachi2/output

  podman run --rm -ti -v "$PWD:/source:z" -v "$LOCAL_CACHE_DIR":/cachi2:z -w /source $HERMETO_IMAGE \
    inject-files /cachi2/output
fi

#############
### IMAGE ###
#############
if [[ "$TYPE" == "image" ]]; then

  # ensure the local cache dir exists
  if [[ ! -d "$LOCAL_CACHE_DIR" ]]; then
    echo "Local cache dir does not exist. Please run the script with 'cache' first."
    echo "example: $0 cache $2"
    exit 1
  fi

  # transform the containerfile to simulate Konflux build
  transformContainerfile "$COMPONENT_DIR/docker/Containerfile" "$COMPONENT_DIR/docker/Containerfile.hermeto"

  podman build -t "$IMAGE" \
      --network none \
      --no-cache \
      -f "$COMPONENT_DIR"/docker/Containerfile.hermeto \
      -v "$LOCAL_CACHE_DIR":/cachi2 \
      "$COMPONENT_DIR"
fi