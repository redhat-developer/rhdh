#!/bin/bash

# Red Hat Developer Hub Backend Debug Startup Script
# This script enables comprehensive debug logging for troubleshooting

# Required environment variables
export ORGANIZATION_NAME="Red Hat Developer Hub"
export FULL_LOGO_WIDTH="120"
export PRIMARY_LIGHT_COLOR="#EE0000"
export HEADER_LIGHT_COLOR_1="#EE0000"
export HEADER_LIGHT_COLOR_2="#CC0000"
export NAV_INDICATOR_LIGHT_COLOR="#EE0000"
export PRIMARY_DARK_COLOR="#EE0000"
export HEADER_DARK_COLOR_1="#EE0000"
export HEADER_DARK_COLOR_2="#CC0000"
export NAV_INDICATOR_DARK_COLOR="#EE0000"
export JIRA_URL="https://jira.example.com"
export LIGHTHOUSE_BASEURL="http://localhost:3001"
export DYNATRACE_URL="https://dynatrace.example.com"
export PERMISSION_ENABLED="true"

# Debug logging options
export LOG_LEVEL="debug"
export DEBUG="*"

# Additional debug options for specific components
# Uncomment the ones you want to debug:
# export DEBUG="backstage:*"                    # All Backstage components
# export DEBUG="backstage:backend:*"            # Backend only
# export DEBUG="backstage:catalog:*"            # Catalog service
# export DEBUG="backstage:auth:*"               # Authentication
# export DEBUG="backstage:scaffolder:*"         # Scaffolder
# export DEBUG="backstage:search:*"             # Search
# export DEBUG="backstage:proxy:*"              # Proxy
# export DEBUG="backstage:permission:*"         # Permissions
# export DEBUG="backstage:rbac:*"               # RBAC
# export DEBUG="backstage:dynamic-plugins:*"    # Dynamic plugins

# Node.js debug options
export NODE_OPTIONS="--inspect=0.0.0.0:9229"

# Winston logger debug
export WINSTON_LEVEL="debug"

echo "Starting Red Hat Developer Hub backend with comprehensive debug logging..."
echo "Debug logs will be very verbose - use Ctrl+C to stop"
echo "Node.js inspector available at: http://localhost:9229"
echo ""

yarn start-backend
