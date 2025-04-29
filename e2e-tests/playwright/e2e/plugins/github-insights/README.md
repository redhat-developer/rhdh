# GitHub Insights Plugin E2E Tests

This directory contains end-to-end tests for the GitHub Insights plugin in Backstage.

## Overview

The tests verify that the GitHub Insights plugin correctly displays repository data from GitHub within Backstage. The tests include:

1. **Installation check** - Verify the GitHub Insights plugin is installed and enabled in the Extensions page
2. **Compliance information check** - Verify the Compliance report card and its contents are visible

## Test Structure

The tests follow this sequence:

### Installation Verification

1. Login as a guest user
2. Navigate to Administration > Extensions
3. Search for "github-insights"
4. Verify the plugin is in the list and enabled

### Compliance Information Verification

1. Login as a GitHub user
2. Navigate to the Backstage Catalog
3. Filter by Component type
4. Select "All" users
5. Open the "Backstage Showcase" component
6. Verify the Compliance report card is visible
7. Verify specific compliance data is visible:
   - Protected Branches information
   - At least one release branch
   - License information including "Apache License"

The tests are designed to be resilient, checking for the presence of elements before attempting to validate their contents.

## Requirements for the Plugin to Work

For the GitHub Insights plugin to work correctly:

1. The plugin must be installed and enabled in Backstage (verified by the first test)
2. The entity must have the proper GitHub annotations
3. The EntityPage layout must include the GitHub Insights component
4. GitHub authentication must be properly configured

## Running the Tests

These tests are run as part of the standard E2E test suite. To run only the GitHub Insights tests, use:

```
cd rhdh/e2e-tests
npx playwright test e2e/plugins/github-insights/github-insights.spec.ts
```

For running with UI mode:

```
npx playwright test --project='showcase' e2e/plugins/github-insights/github-insights.spec.ts --ui
```

## Troubleshooting

If the tests fail, check the following:

1. **Plugin Installation**: Run the first test to verify the plugin is properly installed
2. **Entity Configuration**: Make sure the "Backstage Showcase" component exists and has GitHub insights configured
3. **EntityPage Configuration**: Check if the GitHub Insights component is added to your EntityPage component
4. **Authentication**: Ensure GitHub authentication is properly configured
