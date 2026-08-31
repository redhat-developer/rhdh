#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

(
  source "$SCRIPT_DIR/.env.example"
  [[ "$BASTION_NAME" =~ ^[A-Za-z0-9-]+$ ]]
)

config_contents=$(< "$SCRIPT_DIR/.env.example")
installer_contents=$(< "$SCRIPT_DIR/install-aro-disconnected.sh")
[[ "$config_contents" == *'BASTION_SOURCE_ADDRESS_PREFIX='* ]]
[[ "$installer_contents" == *'BASTION_SOURCE_ADDRESS_PREFIX'* ]]
[[ "$installer_contents" == *'--nsg'* ]]

printf '%s\n' 'manual ARO configuration test passed'
