#!/bin/bash

set -euo pipefail

# This script is a workaround for podman-compose absence of support for depends_on

# Entrypoint for the main RHDH container.
# Waits for the dynamic plugin config to be generated,
# then starts the Backstage backend with appropriate config files.
#
# If user-supplied override files for catalog entities (users/components) exist,
# this script replaces their paths in the base config accordingly.

DYNAMIC_PLUGINS_CONFIG="/opt/app-root/src/dynamic-plugins-root/app-config.dynamic-plugins.yaml"
DEFAULT_APP_CONFIG="configs/app-config/app-config.yaml"
PATCHED_APP_CONFIG="generated/app-config.patched.yaml"

USER_APP_CONFIG="configs/app-config/app-config.local.yaml"
LIGHTSPEED_APP_CONFIG="developer-lightspeed/configs/app-config/app-config.lightspeed.local.yaml"
LEGACY_USER_APP_CONFIG="configs/app-config.local.yaml"

USERS_OVERRIDE="configs/catalog-entities/users.override.yaml"
COMPONENTS_OVERRIDE="configs/catalog-entities/components.override.yaml"

mkdir -p generated
cp -f "$DEFAULT_APP_CONFIG" "$PATCHED_APP_CONFIG"

# ===== CLEAN ARCHITECTURE: DYNAMIC PLUGINS SETUP =====
# Instead of waiting for external service, we run the prepare script directly in container!

echo "🚀 Running dynamic plugins preparation (inside container where all scripts exist)..."

# Set up environment variables that prepare script expects
export DYNAMIC_PLUGINS_ROOT="${DYNAMIC_PLUGINS_ROOT:-/opt/app-root/src/dynamic-plugins-root}"
export NPM_CONFIG_CACHE="/opt/app-root/src/.npm"

# Run the prepare script - it will handle all logic and call the Python installer
/usr/local/bin/prepare-and-install-dynamic-plugins.sh

# Verify the config file was created
if [ -f "$DYNAMIC_PLUGINS_CONFIG" ]; then
    echo "✅ Dynamic plugins config created successfully: $DYNAMIC_PLUGINS_CONFIG"
else
    echo "⚠️ Warning: $DYNAMIC_PLUGINS_CONFIG not found, continuing with minimal config"
fi

# Apply overrides by replacing target paths in the patched config
if [ -f "$USERS_OVERRIDE" ]; then
  echo "Applying users override"
  sed -i "s|/opt/app-root/src/configs/catalog-entities/users.yaml|/opt/app-root/src/$USERS_OVERRIDE|" "$PATCHED_APP_CONFIG"
fi

if [ -f "$COMPONENTS_OVERRIDE" ]; then
  echo "Applying components override"
  sed -i "s|/opt/app-root/src/configs/catalog-entities/components.yaml|/opt/app-root/src/$COMPONENTS_OVERRIDE|" "$PATCHED_APP_CONFIG"
fi

# Add local config if available
EXTRA_CONFIGS=""
if [ -f "$USER_APP_CONFIG" ]; then
  echo "Using user config: $USER_APP_CONFIG"
  EXTRA_CONFIGS="$USER_APP_CONFIG"
elif [ -f "$LEGACY_USER_APP_CONFIG" ]; then
  echo "[warn] Using legacy app-config.local.yaml. This is deprecated. Please migrate to $USER_APP_CONFIG."
  EXTRA_CONFIGS="$LEGACY_USER_APP_CONFIG"
fi

if [ -f "$LIGHTSPEED_APP_CONFIG" ]; then
  echo "Using lightspeed config: $LIGHTSPEED_APP_CONFIG"
  EXTRA_CONFIGS="$EXTRA_CONFIGS $LIGHTSPEED_APP_CONFIG"
fi

EXTRA_CLI_ARGS=""
for config in $EXTRA_CONFIGS; do
  EXTRA_CLI_ARGS="$EXTRA_CLI_ARGS --config $config"
done


echo "🌐 Using BASE_URL from environment: ${BASE_URL:-http://localhost:7007}"

# Export critical environment variables for RHDH (following Containerfile.rhdh-ansible-bootc pattern)
export ENABLE_AUTH_PROVIDER_MODULE_OVERRIDE="${ENABLE_AUTH_PROVIDER_MODULE_OVERRIDE:-true}"

# Start Backstage backend
# Allows variable expansion for CLI args
# shellcheck disable=SC2086 
# NOTE: Removed app-config.example.yaml and app-config.example.production.yaml 
# because they contain PostgreSQL config that overrides our SQLite settings
exec node packages/backend --no-node-snapshot \
  --config "configs/app-config/app-config.yaml" \
  --config "$DYNAMIC_PLUGINS_CONFIG" \
  --config "$PATCHED_APP_CONFIG" $EXTRA_CLI_ARGS