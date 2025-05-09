# GitHub Actions Plugin E2E Tests

This directory contains end-to-end tests for the GitHub Actions plugin integration in RHDH (Red Hat Developer Hub).

## Test Overview

The tests in `github-actions.spec.ts` verify the proper functionality of the GitHub Actions plugin, specifically:

1. Confirming the plugin is properly installed and enabled in the Extensions page
2. Verifying the CI tab is available and accessible for components with GitHub Actions configured

## Prerequisites

- A running instance of RHDH
- The "Backstage Showcase" component must be registered in the catalog with GitHub Actions configured
- Access to a GitHub user account (handled by the `common.loginAsGithubUser()` utility)
- Required environment variables:
  - `GH_USER_ID` - GitHub username
  - `GH_USER_PASS` - GitHub password
  - `GH_USER_2FA_SECRET` - GitHub 2FA secret (if 2FA is enabled)
  - `BASE_URL` - URL of the RHDH instance (defaults to http://localhost:3000 if not set)

Example environment setup:
```bash
export GH_USER_ID=your-github-username
export GH_USER_PASS=your-github-password
export GH_USER_2FA_SECRET=your-2fa-secret
export BASE_URL=http://your-rhdh-instance
```

## Test Structure

The test suite is organized into two main test cases that verify different aspects of the GitHub Actions plugin functionality.

Each test performs these steps:
1. Login as a GitHub user (handled by the `common.loginAsGithubUser()` utility)
2. Navigate to the relevant section of the RHDH UI
3. Perform actions to verify the plugin functionality
4. Assert that expected elements are visible

## Test Cases

### 1. Verify Plugin Installation

This test confirms that the GitHub Actions plugin is properly installed and enabled in the Extensions page:

- Navigates to Administration > Extensions
- Checks the Installed tab
- Searches for the "github-actions" plugin
- Verifies that the plugin is enabled and pre-installed
- Confirms the plugin role is "frontend-plugin"

Key verification points:
- Plugin appears in search results when filtering for "github-actions"
- Plugin status shows as "Yes" for both Enabled and Preinstalled columns
- Plugin role is correctly listed as "frontend-plugin"

### 2. Verify CI Tab Accessibility

This test verifies that the CI tab is accessible for components with GitHub Actions configured:

- Navigates to the Catalog
- Filters for Component kind
- Opens the "Backstage Showcase" component
- Clicks on the CI tab
- Verifies that GitHub Actions content loads by confirming the workflow table is visible

Key verification points:
- CI tab is present in the component page
- After clicking the CI tab, a table with GitHub Actions workflows appears

## Running the Tests

To run these tests specifically:

```bash
npx playwright test e2e/plugins/github-actions/github-actions.spec.ts
```

To run in headed mode (with browser visible):

```bash
npx playwright test e2e/plugins/github-actions/github-actions.spec.ts --headed
```

To run a specific test:

```bash
npx playwright test e2e/plugins/github-actions/github-actions.spec.ts -g "Verify CI tab is available"
```

To run the test in UI mode with the showcase project:

```bash
npx playwright test --project=showcase --ui
```

## Test Timeout Settings

The tests have the following timeout configurations:
- Overall test timeout: 180000ms (3 minutes)
- Page load timeouts: 60000ms (1 minute)
- Tab visibility check: 30000ms (30 seconds)
- Table visibility check: 30000ms (30 seconds)

These timeouts are optimized based on typical RHDH response times and help avoid flaky tests.

## Common Issues

- **Timeout Errors**: If the tests experience timeout errors, verify:
  1. The RHDH instance is properly running
  2. Network connectivity to the instance is stable
  3. The "Backstage Showcase" component has GitHub Actions configured
  
- **Authentication Issues**: If login fails:
  1. Ensure your GitHub user has proper access to the repository
  2. Check that all required environment variables are correctly set
  3. Verify 2FA settings if applicable

## Best Practices

When modifying these tests, keep in mind:

1. Use reliable selectors (prefer data-testid when available)
2. Don't rely on specific text content that might change
3. Add appropriate waiting mechanisms for dynamic content
4. Use appropriate timeouts based on the operation being performed
5. Follow the existing patterns of UI interaction through the `UIhelper` class 