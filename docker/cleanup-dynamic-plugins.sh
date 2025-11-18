#!/bin/bash
#
# Cleanup script to remove unnecessary files from dynamic plugins directory
# This helps reduce disk usage in the emptyDir volume
#
# Usage: Run this script after install-dynamic-plugins.py completes
#

set -e

DYNAMIC_PLUGINS_ROOT="${1:-/dynamic-plugins-root}"

echo "======= Starting cleanup of dynamic plugins directory: ${DYNAMIC_PLUGINS_ROOT}"

# Count initial size
INITIAL_SIZE=$(du -sh "${DYNAMIC_PLUGINS_ROOT}" 2>/dev/null | cut -f1 || echo "unknown")
echo "======= Initial size: ${INITIAL_SIZE}"

# Remove unnecessary files to save space
echo "======= Removing unnecessary files..."

# Remove all .github directories (CI/CD configs, funding, etc)
find "${DYNAMIC_PLUGINS_ROOT}" -type d -name ".github" -exec rm -rf {} + 2>/dev/null || true

# Remove documentation files
find "${DYNAMIC_PLUGINS_ROOT}" -type f \( \
  -name "*.md" -o \
  -name "*.MD" -o \
  -name "CHANGELOG*" -o \
  -name "CONTRIBUTING*" -o \
  -name "LICENSE*" -o \
  -name "AUTHORS*" -o \
  -name "NOTICE*" \
  \) -delete 2>/dev/null || true

# Remove test and example files
find "${DYNAMIC_PLUGINS_ROOT}" -type d \( \
  -name "__tests__" -o \
  -name "test" -o \
  -name "tests" -o \
  -name "spec" -o \
  -name "specs" -o \
  -name "examples" -o \
  -name "example" -o \
  -name "demo" -o \
  -name "fixtures" \
  \) -exec rm -rf {} + 2>/dev/null || true

# Remove source maps (optional - uncomment if you want to save more space)
# find "${DYNAMIC_PLUGINS_ROOT}" -type f -name "*.map" -delete 2>/dev/null || true

# Remove TypeScript source files (keep only compiled JS)
find "${DYNAMIC_PLUGINS_ROOT}" -type f \( \
  -name "*.ts" -o \
  -name "*.tsx" \
  \) ! -name "*.d.ts" -delete 2>/dev/null || true

# Remove empty directories
find "${DYNAMIC_PLUGINS_ROOT}" -type d -empty -delete 2>/dev/null || true

# Count final size
FINAL_SIZE=$(du -sh "${DYNAMIC_PLUGINS_ROOT}" 2>/dev/null | cut -f1 || echo "unknown")
echo "======= Final size: ${FINAL_SIZE}"
echo "======= Cleanup completed successfully"

