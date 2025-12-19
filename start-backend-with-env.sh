#!/bin/bash

# Red Hat Developer Hub Backend Startup Script
# This script sets the required environment variables and starts the backend

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

# Enable debug logging
export LOG_LEVEL="debug"
export DEBUG="*"

echo "Starting Red Hat Developer Hub backend with debug logging enabled..."
yarn start-backend

