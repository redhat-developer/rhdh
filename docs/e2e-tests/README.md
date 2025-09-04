# README for End-to-End Automation Framework

**Stack**: [Playwright](https://playwright.dev/) over TypeScript  
**Repository Location**: [GitHub Repository](https://github.com/redhat-developer/rhdh/tree/main/e2e-tests)

## File Structure of the Testing Framework

| Path                                     | Description                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `e2e-tests/playwright.config.ts`         | Configuration file for Playwright, specifying settings for automating browser interactions in tests or scripts |
| `e2e-tests/playwright/e2e`               | Contains all the end-to-end (E2E) test suites and test cases                                                   |
| `e2e-tests/playwright/e2e/plugins`       | Contains all the dynamic plugins E2E test suites and test cases                                                |
| `e2e-tests/playwright/utils`             | Utilities for easier test development, from UI interaction tasks to network requests                           |
| `e2e-tests/playwright/support`           | Contains helper files for Playwright, like custom commands and page objects                                    |
| `e2e-tests/playwright-report/index.html` | HTML report of the test execution                                                                              |
| `e2e-tests/test-results`                 | Contains video recordings of the executed test cases                                                           |

## Navigate to the E2E Tests Directory and Install Dependencies

From the root of the project directory, navigate to the `e2e-tests` directory:

```bash
cd e2e-tests
yarn install
```

## Install Playwright Browsers

The Playwright browsers should be installed automatically via the `postinstall` script in `package.json`. If not, you can manually install them:

```bash
yarn playwright install chromium
```

## Adding a Test

To incorporate a new test case, create a file with a `.spec.ts` extension in the `e2e-tests/playwright/e2e` directory.
The tests within a spec file can run in parallel (by default) or sequentially if using the `.serial` modifier like in [these examples](../../e2e-tests/playwright/e2e/). Note that sequential execution is considered a bad practice and is strongly discouraged.
To add or edit a test, you should adhere to the [contribution guidelines](./CONTRIBUTING.MD).

## Running the Tests

### Prerequisites

To run the tests, ensure you have:

- **Node.js** (minimum version 18)
- An instance of the application to run the tests against
- [Playwright browsers installed](#install-playwright-browsers)

#### macOS Users
**Important**: If you're using macOS, you need to install GNU `grep` and GNU `sed` to avoid compatibility issues with scripts and CI/CD pipelines:

```bash
brew install grep
brew install gnu-sed
```

**Note**: Make sure to set the GNU versions as default to ensure they are used instead of the built-in macOS versions, which may cause issues when running scripts or tests that expect GNU-compatible behavior.

### Environment Variables

Certain environment variables need to be set up, depending on what you intend to run. The most convenient way is to export them from the CLI or add them in your `.bash_profile` or `.zshrc`. Alternatively, they can be passed to Playwright via the `--env` flag:

```bash
# BASE_URL (The URL to the main page of the application) is mandatory to run all the E2E tests.
VAR_NAME=variable_value npx playwright test
```

The currently supported environment variables are:

| Variable Name            | Description                                                | Required for Tests                      |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------- |
| `BASE_URL`               | The URL to the main page of the application                | All tests                               |
| `GH_USER_ID`             | Your GitHub username, required for logging in using GitHub | Tests involving GitHub authentication   |
| `GH_USER_PASS`           | Your GitHub password                                       | Tests involving GitHub authentication   |
| `GH_2FA_SECRET`          | GitHub 2FA secret used to generate a 2FA OTP for login     | Tests involving GitHub authentication   |
| `GH_USER_TOKEN`          | A classic GitHub token used to make API calls to GitHub    | Tests involving GitHub API interactions |
| `KEYCLOAK_BASE_URL`      | Keycloak base URL                                          | Tests involving Keycloak authentication |
| `KEYCLOAK_REALM`         | Keycloak realm                                             | Tests involving Keycloak authentication |
| `KEYCLOAK_CLIENT_ID`     | Keycloak client ID                                         | Tests involving Keycloak authentication |
| `KEYCLOAK_CLIENT_SECRET` | Keycloak client secret                                     | Tests involving Keycloak authentication |

### Running the Tests

The Playwright command line supports many options; see them [here](https://playwright.dev/docs/test-cli). Flags like `--ui` or `--headed` are very useful when debugging. You can also specify a specific test to run:

```bash
npx playwright test e2e-tests/playwright/e2e/your-test-file.spec.ts
```

Our project contains multiple test suites for different environments and configurations. Some useful scripts to run the tests:

```bash
yarn showcase                       # Runs the showcase test suite
yarn showcase-rbac                  # Runs the showcase RBAC test suite
yarn showcase-1-2-x                 # Runs the showcase 1.2.x test suite
yarn showcase-rbac-1-2-x            # Runs the showcase RBAC 1.2.x test suite
```

## Setting Up Backstage Configuration During the Pipeline

[app-config-rhdh.yaml](../../.ibm/pipelines/resources/config_map/app-config-rhdh.yaml) is the configuration file used to add plugins or any other kind of configuration into Backstage during pipeline execution.

### Environment Variables in `configmap-app-config-rhdh.yaml`

To use environment variables in [`configmap-app-config.yaml`](../../.ibm/pipelines/resources/config_map/app-config-rhdh.yaml), you need to set the variables encoded as Base64 in the [`secrets-rhdh-secrets.yaml`](../../.ibm/pipelines/auth/secrets-rhdh-secrets.yaml). You can use temporary values for the secrets because they can be replaced by the pipeline. Add the required environment variables as Base64-encoded values using secure properties.

To replace the values in `secrets-rhdh-secrets.yaml`, you need to create a replace function using the [`openshift-ci-tests.sh`](../../.ibm/pipelines/openshift-ci-tests.sh) script. For example:

```bash
sed -i "s|KEYCLOAK_BASE_URL:.*|KEYCLOAK_BASE_URL: $KEYCLOAK_BASE_URL|g" $DIR/auth/secrets-rhdh-secrets.yaml
```

This command replaces the `KEYCLOAK_BASE_URL` value in the secrets file with the one provided in your environment variables.
