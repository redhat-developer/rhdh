#!/bin/bash
#
# Playwright Project Names - Single Source of Truth
#
# This file loads project names from e2e-tests/playwright/projects.json
# and exports them as environment variables for CI/CD pipeline scripts.
#
# Usage: source this file in your scripts
#   source "${DIR}/playwright-projects.sh"
#

# Source logging library
# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Navigate from .ibm/pipelines to repo root, then to e2e-tests/playwright
# Convert to absolute path for Node.js require()
PROJECTS_JSON="${DIR}/../../e2e-tests/playwright/projects.json"

if [[ ! -f "${PROJECTS_JSON}" ]]; then
  log::error "projects.json not found at ${PROJECTS_JSON}"
  return 1
fi

log::section "Loading Playwright Project Names"
log::info "Source: ${PROJECTS_JSON}"

# Read project names from JSON and export as environment variables
while IFS='=' read -r key value; do
  export "PW_PROJECT_${key}=${value}"
  log::info "  PW_PROJECT_${key}=${value}"
done < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "${PROJECTS_JSON}")

log::success "Playwright project variables loaded successfully"
