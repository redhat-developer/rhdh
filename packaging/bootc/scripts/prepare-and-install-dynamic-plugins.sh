#!/bin/bash

set -euo pipefail

# Workaround for various issues

# Fix for https://issues.redhat.com/browse/RHIDP-3939
# needed for < 1.4
# if there is no config than the files in dynamic-plugins-root are from the image, and we need to remove them

# Entrypoint for the install-dynamic-plugins container.
# Prepares the dynamic-plugins config, applies compatibility fixes,
# and runs install-dynamic-plugins.sh to generate app-config.dynamic-plugins.yaml.

# Fix for https://issues.redhat.com/browse/RHIDP-3939 - only apply to default location
if [ -d "dynamic-plugins-root" ] && [ "${DYNAMIC_PLUGINS_ROOT:-/dynamic-plugins-root}" = "/dynamic-plugins-root" ]; then
    echo "dynamic-plugins-root exists in default location"
    if [ ! -f "dynamic-plugins-root/app-config.dynamic-plugins.yaml" ]; then
        echo "app-config.dynamic-plugins.yaml does not exist"
        echo "Removing dynamic-plugins-root to fix RHIDP-3939"
        rm -rf ./dynamic-plugins-root
    fi
elif [ -d "dynamic-plugins-root" ]; then
    echo "dynamic-plugins-root exists in custom location - keeping it"
fi

# Fix for https://issues.redhat.com/browse/RHIDP-4410
# needed for < 1.3.0
echo "Removing ~/.npmrc to fix RHIDP-4410"
rm -rf ~/.npmrc

# handle dynamic-plugins config override
DYNAMIC_PLUGINS_DEFAULT="/opt/app-root/src/configs/dynamic-plugins/dynamic-plugins.yaml"
DYNAMIC_PLUGINS_OVERRIDE="/opt/app-root/src/configs/dynamic-plugins/dynamic-plugins.override.yaml"
LINK_TARGET="/var/lib/rhdh/dynamic-plugins.yaml"
NPMRC_PATH="/opt/app-root/src/configs/.npmrc"

# Create writable symlink location
mkdir -p /var/lib/rhdh

if [ -f "$DYNAMIC_PLUGINS_OVERRIDE" ]; then
    echo "Using dynamic-plugins.override.yaml"
    ln -sf "$DYNAMIC_PLUGINS_OVERRIDE" "$LINK_TARGET"
elif [ -f "/opt/app-root/src/configs/dynamic-plugins.yaml" ]; then
    echo "[warn] Using legacy dynamic-plugins.yaml. This method is deprecated. You can override the dynamic plugins configuration by renaming your file into configs/dynamic-plugins/dynamic-plugins.override.yaml"
    ln -sf "/opt/app-root/src/configs/dynamic-plugins.yaml" "$LINK_TARGET"
else
    echo "Using default dynamic-plugins.yaml"
    ln -sf "$DYNAMIC_PLUGINS_DEFAULT" "$LINK_TARGET"
fi

# Create symlink in read-only location pointing to writable location
if [ ! -e "/opt/app-root/src/dynamic-plugins.yaml" ]; then
    ln -sf "$LINK_TARGET" "/opt/app-root/src/dynamic-plugins.yaml" 2>/dev/null || cp "$LINK_TARGET" "/tmp/dynamic-plugins.yaml"
fi

# If a .npmrc was mounted, set the NPM_CONFIG_USERCONFIG env var
if [ -f "$NPMRC_PATH" ]; then
    echo "Found .npmrc, setting NPM_CONFIG_USERCONFIG"
    export NPM_CONFIG_USERCONFIG="$NPMRC_PATH"
else
    echo "No .npmrc found, skipping NPM_CONFIG_USERCONFIG"
fi

echo "Running install-dynamic-plugins.sh"
# Use the correct dynamic plugins directory (either from environment or default)
PLUGINS_DIR="${DYNAMIC_PLUGINS_ROOT:-/dynamic-plugins-root}"
echo "Installing plugins to: $PLUGINS_DIR"

# Ensure the directory exists and is writable
mkdir -p "$PLUGINS_DIR"
chmod 755 "$PLUGINS_DIR"

# Set npm cache to writable location for bootc environments
export NPM_CONFIG_CACHE="${PLUGINS_DIR}/../.npm"
mkdir -p "$NPM_CONFIG_CACHE"

./install-dynamic-plugins.sh "$PLUGINS_DIR"

# Clean up any circular symlinks that might have been created
echo "Cleaning up potential circular symlinks in $PLUGINS_DIR"
find "$PLUGINS_DIR" -name "dynamic-plugins-root" -type l -delete 2>/dev/null || true

# Fix the rootDirectory path in the generated config - no need to change if using the right directory
echo "Fixing rootDirectory path in app-config.dynamic-plugins.yaml"
if [ -f "$PLUGINS_DIR/app-config.dynamic-plugins.yaml" ]; then
    # Only fix if we're using the default location and need to point to the correct directory
    if [ "$PLUGINS_DIR" = "/opt/app-root/src/dynamic-plugins-root" ]; then
        echo "Using standard directory structure - no rootDirectory change needed"
    else
        sed -i "s|rootDirectory: dynamic-plugins-root|rootDirectory: $PLUGINS_DIR|g" "$PLUGINS_DIR/app-config.dynamic-plugins.yaml"
    fi
else
    # Create a minimal config file if none exists (for bootc environments)
    echo "Creating minimal app-config.dynamic-plugins.yaml"
    echo "dynamicPlugins:" > "$PLUGINS_DIR/app-config.dynamic-plugins.yaml"
    echo "  rootDirectory: $PLUGINS_DIR" >> "$PLUGINS_DIR/app-config.dynamic-plugins.yaml"
    chown rhdh:root "$PLUGINS_DIR/app-config.dynamic-plugins.yaml" 2>/dev/null || true
fi