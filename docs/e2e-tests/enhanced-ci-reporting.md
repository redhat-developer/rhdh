# Enhanced CI Reporting

This document describes the enhanced CI reporting system that provides detailed status tracking and notifications for e2e test runs in OpenShift CI.

## Overview

The enhanced CI reporting system uses the [`.ibm/pipelines/reporting.sh`](../../.ibm/pipelines/reporting.sh) script to track various aspects of test execution and deployment status. Results are stored in the `SHARED_DIR` for use by OpenShift CI steps and are formatted into Slack notifications sent to the `#rhdh-e2e-test-alerts` channel.

**Note:** The `SHARED_DIR` can only contain files. No directories or nested structures are supported.

## Using reporting.sh Functions

The [`.ibm/pipelines/reporting.sh`](../../.ibm/pipelines/reporting.sh) script provides several functions to signal different types of results. It uses a Bash array to store statuses for multiple deployments, indexed by `CURRENT_DEPLOYMENT` (a deployment number).

### Core Reporting Functions

#### `save_status_deployment_namespace(deployment, namespace)`
Records the namespace where a deployment was created.

```bash
save_status_deployment_namespace $CURRENT_DEPLOYMENT $namespace
```

#### `save_status_failed_to_deploy(deployment, status)`
Records whether a deployment failed (true/false).

```bash
save_status_failed_to_deploy $CURRENT_DEPLOYMENT false  # Success
save_status_failed_to_deploy $CURRENT_DEPLOYMENT true   # Failure
```

#### `save_status_test_failed(deployment, status)`
Records whether tests failed for a deployment (true/false).

```bash
save_status_test_failed $CURRENT_DEPLOYMENT false  # Tests passed
save_status_test_failed $CURRENT_DEPLOYMENT true   # Tests failed
```

#### `save_status_number_of_test_failed(deployment, number)`
Records the number of failed tests.

```bash
save_status_number_of_test_failed $CURRENT_DEPLOYMENT "3"
```

#### `save_overall_result(result)`
Records the overall test result (0 for success, 1 for failure).

```bash
save_overall_result 0  # Overall success
save_overall_result 1  # Overall failure
```

## SHARED_DIR Integration

All status information is written to files in the `SHARED_DIR` directory, which is shared between OpenShift CI steps:

- `SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt` - Bash array format
- `SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt` - Bash array format
- `SHARED_DIR/STATUS_TEST_FAILED.txt` - Bash array format
- `SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt` - Bash array format
- `SHARED_DIR/STATUS_URL_REPORTPORTAL.txt` - Bash array format
- `SHARED_DIR/OVERALL_RESULT.txt` - Single value

The status files use bash arrays indexed by `CURRENT_DEPLOYMENT` (deployment number), except for `OVERALL_RESULT.txt` which contains a single value. These files are also copied to `ARTIFACT_DIR/reporting/` for artifact collection.

## Usage Examples

### In Test Scripts

```bash
# Source the reporting functions
source "${DIR}/reporting.sh"

# Initialize overall result
save_overall_result 0

# Record deployment success
save_status_deployment_namespace $CURRENT_DEPLOYMENT "showcase"
save_status_failed_to_deploy $CURRENT_DEPLOYMENT false

# Record test results
if [ "${RESULT}" -ne 0 ]; then
    save_overall_result 1
    save_status_test_failed $CURRENT_DEPLOYMENT true
else
    save_status_test_failed $CURRENT_DEPLOYMENT false
fi

# Record number of failed tests
failed_tests=$(grep -oP 'failures="\K[0-9]+' "${JUNIT_RESULTS}" | head -n 1)
save_status_number_of_test_failed $CURRENT_DEPLOYMENT "${failed_tests}"
```

### Error Handling

The system automatically handles script failures through the cleanup trap. See [`.ibm/pipelines/openshift-ci-tests.sh`](../../.ibm/pipelines/openshift-ci-tests.sh).

## OpenShift CI Integration

The reporting system integrates with OpenShift CI through:

1. **Step Registry**: OpenShift CI steps can read the status files from `SHARED_DIR`
2. **Artifact Collection**: Status files are preserved in artifacts for debugging
3. **Slack Notifications**: Results are formatted and sent to `#rhdh-e2e-test-alerts`

### The `redhat-developer-rhdh-send-alert` step

The `redhat-developer-rhdh-send-alert` step is defined in the [OpenShift release repository](https://github.com/openshift/release) under [`ci-operator/step-registry/redhat-developer/rhdh/send/alert/`](https://github.com/openshift/release/tree/master/ci-operator/step-registry/redhat-developer/rhdh/send/alert). This step:

- Runs as a post-step in OpenShift CI jobs
- Reads the status files from `SHARED_DIR` that were written by the reporting functions
- Formats the collected status information into structured Slack messages
- Sends notifications to the `#rhdh-e2e-test-alerts` channel
- Handles multiple deployments and their individual test results
- Provides links to job logs, artifacts, and ReportPortal results

The step is configured in job definitions to run after test execution completes, ensuring all status information is captured and reported.

## Slack Notifications

For nightly runs, the system automatically sends notifications to the `#rhdh-e2e-test-alerts` Slack channel. The message format includes:

- **Job Header**: Job name with overall status
- **Logs Link**: Direct link to job logs
- **Triage Mention**: `@rhdh-ci-test-triage` for team notification
- **Per-Deployment Status**: Each deployment shows:
  - **Deployment Name**: e.g., `showcase-ci-nightly`, `showcase-rbac-nightly`
  - **Deployment Status**: "deployed" status
  - **Test Results**: "tests passed" or failure count (e.g., "2 tests failed")
  - **Tools**: Playwright, ReportPortal, and artifacts links

## File Locations

- **Script**: [`.ibm/pipelines/reporting.sh`](../../.ibm/pipelines/reporting.sh)
- **Integration**: [`.ibm/pipelines/utils.sh`](../../.ibm/pipelines/utils.sh) and [`.ibm/pipelines/openshift-ci-tests.sh`](../../.ibm/pipelines/openshift-ci-tests.sh)

## Related Documentation

- [CI Testing Overview](CI.md)
- [E2E Tests Examples](examples.md)
- [Contributing to E2E Tests](CONTRIBUTING.MD) 