# GitHub Issues Plugin E2E Tests

This directory contains end-to-end tests for the GitHub Issues plugin integration with Red Hat Developer Hub (RHDH). The tests verify that the GitHub Issues plugin is correctly installed and functioning within the RHDH environment.

## Component Under Test

The GitHub Issues plugin is a Backstage community plugin (`backstage-community-plugin-github-issues`) that integrates GitHub issue tracking into the RHDH/Backstage UI. It allows users to view GitHub issues directly within component pages in the catalog.

## Test Coverage

The tests verify:

1. **Plugin Installation Verification:**

   - Navigates to the Extensions page under Administration
   - Searches for the GitHub Issues plugin
   - Confirms the plugin is installed and visible in the UI

2. **Functional Testing:**
   - Navigates to the "Backstage Showcase" component in the catalog
   - Verifies the Issues tab is present on the component page
   - Clicks the Issues tab and waits for GitHub data to load
   - Confirms that GitHub Issues content is displayed correctly
   - Validates the URL contains the expected "issues" path segment

## Test Implementation Details

The tests use:

- **Playwright** for browser automation and assertions
- **UIhelper** utility for common UI interactions and navigation
- **Common** utility for authentication and shared functionality

Authentication is performed using GitHub credentials (requires `GH_USER2_ID` environment variable) before each test to ensure proper access to GitHub data.

The tests include appropriate waiting mechanisms for:

- Page loading (including networkidle states)
- API responses from GitHub
- UI elements to become visible

## Running Tests

These tests are part of the RHDH Playwright E2E test suite and require:

- A running RHDH instance with the GitHub Issues plugin installed
- Valid GitHub credentials with access to the repositories being tested
- Environment variables:
  - `GH_USER2_ID`: GitHub username for authentication

Run the tests using the standard Playwright command for this test directory.

## Files

- `github-issues.spec.ts` - Contains the Playwright test definitions and implementation
- `README.md` - This documentation file
