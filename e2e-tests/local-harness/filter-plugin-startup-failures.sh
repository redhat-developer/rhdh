#!/bin/bash
#
# Filters RHDH backend logs on stdin down to the dynamic-plugin startup failures
# worth reporting, one per line on stdout.
#
# Backstage emits three fatal shapes (createInitializationResultCollector):
# "Plugin '<id>' threw an error during startup", "Module '<m>' in Plugin '<id>'
# threw an error during startup", and "Plugin '<id>' reported failure for module
# '<m>' during startup". The near-identical variants ending in "boot failure is
# permitted ... so startup will continue" are NON-fatal and must not be reported.
#
# Shared by the cluster path (testing::report_plugin_startup_failures reads pod
# logs) and the cluster-free path (the plugin-sanity GitHub Actions job reads the
# piped webServer log), so the log shapes are described in exactly one place.
#
# Usage:
#   oc logs ... | filter-plugin-startup-failures.sh
set -e

grep -E "(threw an error|reported failure for module).*during startup|Backend startup failed" \
  | grep -v "boot failure is permitted" \
  | sort -u
