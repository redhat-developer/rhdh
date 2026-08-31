#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

(
  source "$SCRIPT_DIR/.env.example"
  [[ "$BASTION_NAME" =~ ^[A-Za-z0-9-]+$ ]]
)

config_contents=$(< "$SCRIPT_DIR/.env.example")
installer_contents=$(< "$SCRIPT_DIR/install-aro-disconnected.sh")
setup_contents=$(< "$SCRIPT_DIR/setup-bastion.sh")
readme_contents=$(< "$SCRIPT_DIR/README.md")
[[ "$config_contents" == *'BASTION_SOURCE_ADDRESS_PREFIX='* ]]
[[ "$installer_contents" == *'BASTION_SOURCE_ADDRESS_PREFIX'* ]]
[[ "$installer_contents" == *'--nsg'* ]]
[[ "$installer_contents" == *'/.local/'* ]]
[[ "$installer_contents" == *'--upgrade'* ]]
[[ "$setup_contents" == *'OPENSHIFT_VERSION'* ]]
[[ "$setup_contents" == *'HELM_VERSION'* ]]
[[ "$setup_contents" == *'sha256sum'* ]]
[[ "$readme_contents" == *'scp '* ]]

printf '%s\n' 'manual ARO configuration test passed'
