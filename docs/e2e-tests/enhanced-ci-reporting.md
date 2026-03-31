# Enhanced CI Reporting

This document describes the enhanced CI reporting system that provides detailed status tracking and notifications for e2e test runs in OpenShift CI.

## Overview

The enhanced CI reporting system uses the [`.ci/pipelines/reporting.sh`](../../.ci/pipelines/reporting.sh) script to track various aspects of test execution and deployment status. Results are stored in the `SHARED_DIR` for use by OpenShift CI steps and are formatted into Slack notifications sent to the `#rhdh-e2e-alerts` channel.

**Note:** The `SHARED_DIR` can only contain files. No directories or nested structures are supported.

## Architecture

### Test Run Tracker Module

The [`.ci/pipelines/lib/test-run-tracker.sh`](../../.ci/pipelines/lib/test-run-tracker.sh) module encapsulates all test run state management into a clean API. It manages an internal counter and delegates status persistence to `reporting.sh`.

#### `test_run_tracker::register(label)`
Registers a new test run with the given label (typically the Playwright project name or artifacts subdirectory). Increments the internal counter and records the label.

```bash
test_run_tracker::register "$artifacts_subdir"
```

#### `test_run_tracker::mark_deploy_success()`
Marks the current test run's deployment phase as successful.

```bash
test_run_tracker::mark_deploy_success
```

#### `test_run_tracker::mark_deploy_failed(label)`
Registers a new test run and marks it as failed (deploy failed, tests failed, overall result = 1).

```bash
test_run_tracker::mark_deploy_failed "$artifacts_subdir"
```

#### `test_run_tracker::mark_test_result(passed, num_failures)`
Records whether tests passed and the number of failures.

```bash
test_run_tracker::mark_test_result "$test_passed" "${failed_tests}"
```

#### `test_run_tracker::current_id()`
Returns the current test run counter value.

```bash
local id
id="$(test_run_tracker::current_id)"
```

### Core Reporting Functions

The [`.ci/pipelines/reporting.sh`](../../.ci/pipelines/reporting.sh) script provides low-level functions used internally by the test run tracker module. These persist status to `SHARED_DIR` files and `ARTIFACT_DIR/reporting/`.

#### `save_status_deployment_namespace(deployment, label)`
Records the label for a deployment.

#### `save_status_failed_to_deploy(deployment, status)`
Records whether a deployment failed (true/false).

#### `save_status_test_failed(deployment, status)`
Records whether tests failed for a deployment (true/false).

#### `save_status_number_of_test_failed(deployment, number)`
Records the number of failed tests.

#### `save_overall_result(result)`
Records the overall test result (0 for success, 1 for failure).

## SHARED_DIR Integration

All status information is written to files in the `SHARED_DIR` directory, which is shared between OpenShift CI steps:

- `SHARED_DIR/STATUS_DEPLOYMENT_NAMESPACE.txt` - Deployment labels (one per line)
- `SHARED_DIR/STATUS_FAILED_TO_DEPLOY.txt` - Deploy failure flags (one per line)
- `SHARED_DIR/STATUS_TEST_FAILED.txt` - Test failure flags (one per line)
- `SHARED_DIR/STATUS_NUMBER_OF_TEST_FAILED.txt` - Failure counts (one per line)
- `SHARED_DIR/STATUS_URL_REPORTPORTAL.txt` - ReportPortal URLs
- `SHARED_DIR/OVERALL_RESULT.txt` - Single value

These files are also copied to `ARTIFACT_DIR/reporting/` for artifact collection.

## Usage Examples

### In Test Scripts

```bash
# Source the required modules (typically done via utils.sh)
source "${DIR}/reporting.sh"
source "${DIR}/lib/test-run-tracker.sh"

# Initialize overall result
save_overall_result 0

# Register a test run and mark its deployment as successful
test_run_tracker::register "showcase"
test_run_tracker::mark_deploy_success

# Record test results
test_run_tracker::mark_test_result "$test_passed" "${failed_tests}"

# Or mark a deployment as failed in one call
test_run_tracker::mark_deploy_failed "showcase-rbac"
```

### Error Handling

The system automatically handles script failures through the cleanup trap. See [`.ci/pipelines/openshift-ci-tests.sh`](../../.ci/pipelines/openshift-ci-tests.sh).

## OpenShift CI Integration

The reporting system integrates with OpenShift CI through:

1. **Step Registry**: OpenShift CI steps can read the status files from `SHARED_DIR`
2. **Artifact Collection**: Status files are preserved in artifacts for debugging
3. **Slack Notifications**: Results are formatted and sent to `#rhdh-e2e-alerts`

### The `redhat-developer-rhdh-send-alert` step

The `redhat-developer-rhdh-send-alert` step is defined in the [OpenShift release repository](https://github.com/openshift/release) under [`ci-operator/step-registry/redhat-developer/rhdh/send/alert/`](https://github.com/openshift/release/tree/master/ci-operator/step-registry/redhat-developer/rhdh/send/alert). This step:

- Runs as a post-step in OpenShift CI jobs
- Reads the status files from `SHARED_DIR` that were written by the reporting functions
- Formats the collected status information into structured Slack messages
- Sends notifications to the `#rhdh-e2e-alerts` channel
- Handles multiple deployments and their individual test results
- Provides links to job logs, artifacts, and ReportPortal results

The step is configured in job definitions to run after test execution completes, ensuring all status information is captured and reported.

## Slack Notifications

For nightly runs, the system automatically sends notifications to the `#rhdh-e2e-alerts` Slack channel (main branch) or `#rhdh-e2e-alerts-{VERSION}` channels for release branches (e.g., `#rhdh-e2e-alerts-1-9`, `#rhdh-e2e-alerts-1-10`). The message format includes:

- **Job Header**: Job name with overall status
- **Logs Link**: Direct link to job logs
- **Triage Mention**: `@rhdh-ci-test-triage` for team notification
- **Per-Deployment Status**: Each deployment shows:
  - **Deployment Label**: e.g., `showcase`, `showcase-rbac`, `showcase-runtime`
  - **Deployment Status**: "deployed" status
  - **Test Results**: "tests passed" or failure count (e.g., "2 tests failed")
  - **Tools**: Playwright, ReportPortal, and artifacts links

## File Locations

- **Test Run Tracker**: [`.ci/pipelines/lib/test-run-tracker.sh`](../../.ci/pipelines/lib/test-run-tracker.sh)
- **Reporting Script**: [`.ci/pipelines/reporting.sh`](../../.ci/pipelines/reporting.sh)
- **Integration**: [`.ci/pipelines/utils.sh`](../../.ci/pipelines/utils.sh) and [`.ci/pipelines/openshift-ci-tests.sh`](../../.ci/pipelines/openshift-ci-tests.sh)

## Related Documentation

- [CI Testing Overview](CI.md)
- [E2E Tests Examples](examples.md)
- [Contributing to E2E Tests](CONTRIBUTING.MD)
