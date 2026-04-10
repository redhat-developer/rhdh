---
description: >-
  AI-powered PR check failure triage tool. Analyzes build logs, identifies error
  patterns, compares failures across PRs, searches Jira for existing issues, and
  provides actionable recommendations.
---
# PR Triage

Automated triage for RHDH PR check failures. Analyzes build logs, detects patterns, searches for duplicate issues in Jira, and provides recommendations.

## Flow

1. Gather PR numbers or job URLs from the user
2. Fetch and analyze build logs from GCS
3. Extract error patterns and failure points
4. Compare failures across PRs to detect duplicates
5. Search Jira for existing `ci-fail` tickets
6. Present comprehensive triage report with recommendations

## Step 1: Gather Inputs

Accept flexible input formats from the user:

- **PR URLs**: `https://github.com/redhat-developer/rhdh/pull/4537`
- **PR numbers**: `4537`, `4418`, `4501`, `#4537`
- **Prow job URLs**: Full URLs like `https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/4537/...`
- **Natural language**: "check the last 5 failed PR checks", "analyze ocp-helm failures today"
- **Keywords**: "all failed", "recent failures", "release-1.8 failures"

### Extract PR Number from Input

```bash
# From GitHub PR URL
echo "https://github.com/redhat-developer/rhdh/pull/4537" | sed -nE 's|.*/pull/([0-9]+).*|\1|p'

# From Prow job URL
echo "https://prow.ci.openshift.org/view/gs/.../pull/redhat-developer_rhdh/4537/..." | sed -nE 's|.*/redhat-developer_rhdh/([0-9]+).*|\1|p'

# From user input with # prefix
echo "#4537" | grep -oE '[0-9]+'
```

### Auto-detection Mode

If the user says "recent failures" or "check failed PRs", fetch recent failures:

```bash
# Fetch recent PR jobs from Prow
# Note: prowjobs.js returns ALL jobs (several MB), so we filter client-side with jq
curl -s 'https://prow.ci.openshift.org/prowjobs.js' | \
  jq -r '.items[] | select(.spec.job | test("^pull-ci-redhat-developer-rhdh-.*-e2e-")) | select(.status.state == "failure") | "\(.spec.refs.pulls[0].number)|\(.spec.job)|\(.status.url)"' | \
  head -20
```

Present as a table and let the user select which ones to analyze.

## Step 2: Fetch Build Logs

For each PR/job, construct the GCS URL and fetch the build log:

**URL Pattern** (replace placeholders with actual values):
```
https://storage.googleapis.com/test-platform-results/pr-logs/pull/redhat-developer_rhdh/{PR_NUMBER}/{JOB_NAME}/{BUILD_ID}/build-log.txt

Example:
https://storage.googleapis.com/test-platform-results/pr-logs/pull/redhat-developer_rhdh/4537/pull-ci-redhat-developer-rhdh-release-1.8-e2e-ocp-helm/2042237810542383104/build-log.txt
```

**How to find the BUILD_ID:**

Option A: Extract from Prow job URL (if provided)
```
https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/4537/pull-ci-redhat-developer-rhdh-release-1.8-e2e-ocp-helm/2041819081065107456/build-log.txt
                                                                                                                                           ^^^^^^^^^^^^^^^^^^^^^
```

Option B: Query Prow API for latest build ID
```bash
# Note: prowjobs.js doesn't support query parameters, filter in jq
# Example: Set your values here
PR_NUMBER=4537
JOB_NAME="pull-ci-redhat-developer-rhdh-release-1.8-e2e-ocp-helm"

curl -s 'https://prow.ci.openshift.org/prowjobs.js' | \
  jq -r --arg job "$JOB_NAME" --arg pr "$PR_NUMBER" \
    '.items[] | select(.spec.job == $job and .spec.refs.pulls[0].number == ($pr | tonumber)) | .status.build_id' | \
  head -1
```

Option C: List directory to find latest build
```bash
# Example: Set your PR number here
PR_NUMBER=4537

curl -s "https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/$PR_NUMBER/" | \
  grep -oE 'pull-ci-redhat-developer-rhdh[^"]+' | sort -u
```

**Fetch the log and extract errors:**
```bash
# Example: Set your values here (from steps above)
PR_NUMBER=4537
JOB_NAME="pull-ci-redhat-developer-rhdh-release-1.8-e2e-ocp-helm"
BUILD_ID="2042237810542383104"

# Download full build log
BUILD_LOG_URL="https://storage.googleapis.com/test-platform-results/pr-logs/pull/redhat-developer_rhdh/$PR_NUMBER/$JOB_NAME/$BUILD_ID/build-log.txt"
curl -s "$BUILD_LOG_URL" > /tmp/build-log-$PR_NUMBER.txt

# Extract actual error messages (NOT summaries - show raw errors)
grep -E -A 10 -B 5 "Error|FAIL|Failed|Timed out" /tmp/build-log-$PR_NUMBER.txt | tail -50

# Extract structured error logs
grep -E '"level":"error"' /tmp/build-log-$PR_NUMBER.txt | tail -10

# Get final failure summary
tail -100 /tmp/build-log-$PR_NUMBER.txt | head -50
```

**CRITICAL**: Always show the ACTUAL error text from the log, not AI-generated summaries. Users need to see the real errors to verify the analysis.

## Step 3: Analyze Error Patterns

Use the failure classification from the CI Medic Guide to categorize each failure:

### Infrastructure Failures

**Indicators:**
- Job status: `error` (not `failure`)
- Cluster provisioning errors
- No test artifacts exist

**Search patterns in build log:**
```
- "Cluster pool exhausted"
- "Cluster claim timeout"
- "failed to acquire lease"
- "error: no cluster available"
```

**Classification:** `INFRA_CLUSTER_PROVISIONING`

### Deployment Failures

**Indicators:**
- Deployment phase errors before test execution
- Pod crash loops
- Health check timeouts

**Search patterns:**
```
- "CrashLoopBackOff"
- "Failed to reach Backstage"
- "helm upgrade.*failed"
- "Crunchy Postgres operator failed to create the user"
- "ImagePullBackOff"
- "FailedScheduling"
```

**Classification:** `DEPLOY_FAILED` with subcategories:
- `DEPLOY_POSTGRES` - PostgreSQL operator issues
- `DEPLOY_HELM` - Helm chart failures
- `DEPLOY_OPERATOR` - Operator CRD/deployment issues
- `DEPLOY_HEALTH_CHECK` - Health check timeouts
- `DEPLOY_IMAGE_PULL` - Image pull failures

### Test Failures

**Indicators:**
- JUnit XML exists with test failures
- Playwright report shows specific test failures
- Tests ran but failed assertions

**Search patterns:**
```
- "tests passed" vs "tests failed"
- "X failed, Y passed" in test summary
- JUnit results in artifacts
```

**Classification:** `TEST_FAILED` with subcategories:
- `TEST_FLAKY` - Passed on retry
- `TEST_CONSISTENT` - Failed across all retries
- `TEST_TIMEOUT` - Test execution timeout
- `TEST_ASSERTION` - Assertion failures

### Extract Detailed Error Info

For each failure, extract:

1. **Error message**: The actual error text (first 200 chars)
2. **Stack trace**: If available (first 10 lines)
3. **Failure phase**: Which lifecycle phase (see CI Medic Guide sections)
4. **Affected namespace**: Which deployment namespace
5. **Playwright project**: Which test project failed (if test failure)

**Example extraction logic:**

```bash
# Extract the main error
grep -E -A 5 "❌|Error|FAIL|Failed" build-log.txt | head -20

# Find which namespace failed
sed -nE 's/.*namespace:[[:space:]]*([^[:space:]]+).*/\1/p' build-log.txt

# Find Playwright project
sed -nE 's/.*playwright test --project=([^[:space:]]+).*/\1/p' build-log.txt
```

## Step 4: Compare Failures Across PRs

### Fingerprint Generation

Create a fingerprint for each failure to detect duplicates:

```
{FAILURE_TYPE}:{ERROR_PATTERN}:{NAMESPACE}:{PLAYWRIGHT_PROJECT}
```

**Example:**
```
DEPLOY_POSTGRES:Crunchy Postgres operator failed:showcase-rbac-nightly:showcase-rbac
```

### Similarity Detection

Compare fingerprints across all analyzed PRs:

1. **Exact match**: Same fingerprint → Identical failure
2. **Partial match**: Same error pattern, different namespace → Related failure
3. **Error text similarity**: Use fuzzy matching (Levenshtein distance) on error messages

**Output:**
```
PR #4537: DEPLOY_POSTGRES:Crunchy Postgres operator failed:showcase-rbac-nightly
PR #4418: DEPLOY_POSTGRES:Crunchy Postgres operator failed:showcase-rbac-nightly
PR #4501: DEPLOY_POSTGRES:Crunchy Postgres operator failed:showcase-nightly

→ Identical: #4537, #4418
→ Related: #4501 (same error, different namespace)
```

## Step 5: Search Jira for Existing Issues

**ALWAYS** search Jira for existing ci-fail tickets to avoid creating duplicates.

### Automatic MCP Detection and Search

**Step 1: Check if Atlassian MCP server is available**

```
Use ListMcpResourcesTool with server: "atlassian"
```

- If MCP server exists → Proceed to **Programmatic Search** (below)
- If MCP server not found → Proceed to **Fallback: Web Dashboard Links** (below)

### Programmatic Search (MCP Available)

When Atlassian MCP server is configured, automatically search Jira and include results in the report.

**CRITICAL**: Jira Cloud requires **bounded JQL** - always add `updated >= -365d` or similar time constraint.

**Search 1: All unresolved ci-fail tickets (last 365 days)**

```
mcp__atlassian__searchJiraIssuesUsingJql({
  cloudId: "redhat.atlassian.net",
  jql: "project = RHDHBUGS AND labels = \"ci-fail\" AND resolution = Unresolved AND updated >= -365d ORDER BY created DESC",
  maxResults: 50,
  responseContentFormat: "markdown",
  fields: ["key", "summary", "status", "created", "description", "labels", "assignee"]
})
```

**Search 2: Filter by error pattern keywords**

For each detected failure, extract keywords and search:

```
# Example: Docker image timeout
mcp__atlassian__searchJiraIssuesUsingJql({
  cloudId: "redhat.atlassian.net",
  jql: "project = RHDHBUGS AND labels = \"ci-fail\" AND (summary ~ \"Docker image\" OR summary ~ \"timeout\" OR description ~ \"Docker image\") AND resolution = Unresolved AND updated >= -365d",
  maxResults: 20,
  responseContentFormat: "markdown",
  fields: ["key", "summary", "status", "created", "description", "assignee"]
})
```

**Analyze Results:**
- Compare error patterns from build logs with Jira ticket summaries/descriptions
- Calculate match confidence (>70% = potential match)
- Identify duplicate tickets vs. need to create new

**Include in Report:**
- List of matching tickets with ticket key, summary, status, assignee
- Match confidence percentage
- Recommendation: Update existing vs. create new

### Fallback: Web Dashboard Links (MCP Not Available)

If MCP is not configured or returns an error, provide search URLs for manual review:

**JQL Pattern** (Jira Query Language):
```
project = RHDHBUGS AND labels = "ci-fail" AND resolution = Unresolved AND updated >= -365d ORDER BY created DESC
```

**Generated Search URLs:**

```bash
# All unresolved ci-fail tickets (last 365 days)
https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20resolution%20%3D%20Unresolved%20AND%20updated%20%3E%3D%20-365d%20ORDER%20BY%20created%20DESC

# Search by keywords (example: Docker image)
https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20(summary%20~%20%22Docker%20image%22%20OR%20summary%20~%20%22timeout%22)%20AND%20resolution%20%3D%20Unresolved
```

**Include in Report:**
- Note that MCP is not configured
- Provide clickable search URLs
- Instruct user to manually review for duplicates

### Extract Search Keywords from Error

For each detected failure, extract keywords for Jira searching:

1. **Extract key error terms**: 
   ```bash
   # Example error: "Timed out waiting for Docker image :pr-4537-9c77192a"
   # Keywords: "Docker image", "timeout", "waiting"
   
   # Example error: "Crunchy Postgres operator failed to create the user"
   # Keywords: "PostgreSQL operator", "create user", "failed"
   ```

2. **Build Jira search URLs**:
   ```bash
   # URL encode keywords (replace spaces with %20)
   KEYWORDS="Docker%20image"
   
   # Generate and open search URL
   open "https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20text%20~%20%22$KEYWORDS%22%20AND%20resolution%20%3D%20Unresolved"
   ```

3. **Semantic matching criteria** (if manually checking):
   - Same error message substring (>70% match)
   - Same failure phase + component
   - Same infrastructure/deployment pattern
   - Same test failure pattern

**Example:**
```
Detected Error: "Timed out waiting for Docker image :pr-4537-9c77192a"

Search Keywords:
- "Docker image timeout"
- "waiting for Docker image"  
- "image availability"
- "fork PR"

Generated URLs:
https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20text%20~%20%22Docker%20image%22%20AND%20resolution%20%3D%20Unresolved
```

## Step 6: Generate Triage Report

**CRITICAL**: Output the report directly to the conversation. DO NOT write to a file first unless explicitly told by the user. You are to display the full report in your response so the user can see it immediately.

Present a comprehensive report with this structure:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 PR CHECK FAILURE TRIAGE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated: {TIMESTAMP}
Analyzed: {N} PR(s)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 INDIVIDUAL PR ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PR #{NUMBER} - {JOB_NAME}
├─ 🔗 Job URL: {PROW_URL}
├─ 📄 Build Log: {GCS_URL}
├─ 🎭 Playwright: {PLAYWRIGHT_PROJECT}
├─ 📦 Namespace: {NAMESPACE}
├─ ⚠️  Failure Type: {FAILURE_TYPE}
│
├─ 💬 **Actual Error Message(s) from Build Log**:
│   ```
│   {ACTUAL_RAW_ERROR_TEXT_FROM_LOG}
│   ```
│
├─ 📝 **Structured Error Log** (if available):
│   ```json
│   {JSON_ERROR_IF_PRESENT}
│   ```
│
└─ 🔍 **Error Context** (surrounding lines):
    ```
    {LINES_BEFORE_AND_AFTER_ERROR}
    ```

[Repeat for each PR]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎫 JIRA TICKET SEARCH RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Search Keywords**: {EXTRACTED_KEYWORDS}

**MCP Status**: {✅ Available | ❌ Not configured}

[IF MCP AVAILABLE - Include actual search results]:

**All ci-fail Tickets (last 365 days)** - {N} tickets found:

- RHDHBUGS-1234: PostgreSQL operator timeout
  Status: Open | Assignee: user@redhat.com | Created: 2026-03-15
  https://redhat.atlassian.net/browse/RHDHBUGS-1234
  
- RHDHBUGS-5678: Docker image build failure for fork PRs
  Status: In Progress | Assignee: dev@redhat.com | Created: 2026-03-20
  https://redhat.atlassian.net/browse/RHDHBUGS-5678

**Filtered by Error Pattern** ("{KEYWORDS}") - {N} matches:

- RHDHBUGS-5678: Docker image build failure for fork PRs
  Status: In Progress | Assignee: dev@redhat.com
  Description excerpt: "...timed out waiting for Docker image..."
  **Match Confidence**: 85% (keywords: Docker image, timeout, fork PR)

**Potential Matches**:

Group 1: {FAILURE_PATTERN_NAME}
├─ Existing Ticket: RHDHBUGS-5678 (In Progress)
├─ Title: "Docker image build failure for fork PRs"
├─ URL: https://redhat.atlassian.net/browse/RHDHBUGS-5678
├─ Match Confidence: 85%
├─ Assignee: dev@redhat.com
├─ Description Match: "timed out waiting for Docker image" (similar to current error)
└─ Recommendation: ✅ Update existing ticket with PR #4537

Group 2: {PATTERN_NAME}
├─ Existing Ticket: None found
├─ Recommendation: ⚠️  Create new Jira ticket
└─ Suggested Title: "{AUTO_GENERATED_TITLE}"

[IF MCP NOT AVAILABLE - Include search links]:

**MCP Not Configured** - Manual search required

**Search Links** (Click to open in browser):

1. All unresolved ci-fail tickets (last 365 days):
   https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20resolution%20%3D%20Unresolved%20AND%20updated%20%3E%3D%20-365d%20ORDER%20BY%20created%20DESC

2. Search for Docker image timeout issues:
   https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20(summary%20~%20%22Docker%20image%22%20OR%20summary%20~%20%22timeout%22)%20AND%20resolution%20%3D%20Unresolved

**Manual Review Steps**:
1. Open the search links above
2. Review ticket summaries and descriptions
3. Look for matches with error patterns from this report
4. Update existing ticket if found, otherwise create new

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

High Priority:
1. [Group 1] Update RHDHBUGS-1234 with PRs #4537, #4418, #4501
   - Add comment: "Also affects PRs #4418, #4501"
   - Consider marking tests as test.fixme if blocking PRs

2. [Group 2] Create new Jira ticket for {PATTERN_NAME}
   - Suggested command: Create ticket with label 'ci-fail'
   - Assign to: {SUGGESTED_ASSIGNEE}

Infrastructure Issues:
- {N} PRs affected by cluster provisioning (re-trigger recommended)

Flaky Tests:
- {N} PRs with flaky test failures (file flaky test tickets)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 SUMMARY STATISTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total PRs Analyzed: {N}
Infrastructure Failures: {N} ({PERCENTAGE}%)
Deployment Failures: {N} ({PERCENTAGE}%)
Test Failures: {N} ({PERCENTAGE}%)

Duplicate Groups Detected: {N}
Existing Jira Tickets: {N}
New Tickets Needed: {N}

Most Common Failure: {FAILURE_TYPE} ({N} occurrences)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 MONITORING LINKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Monitor CI/CD Status**:
- Monitor PR Check Status: https://prow.ci.openshift.org/?job=pull-ci-redhat-developer-rhdh-%2A-e2e%2A
- Monitor PR Checks Queue: https://prow.ci.openshift.org/job-history/gs/test-platform-results/pr-logs/directory/pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm
- Monitor Nightly Jobs: https://prow.ci.openshift.org/?type=periodic&job=periodic-ci-redhat-developer-rhdh-%2A-e2e-%2A

**Documentation**:
- CI Medic Guide: docs/e2e-tests/CI-medic-guide.md
- Jira ci-fail Dashboard: https://redhat.atlassian.net/issues/?jql=labels%20%3D%20%22ci-fail%22%20AND%20resolution%20%3D%20Unresolved%20ORDER%20BY%20created%20DESC

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 7: Interactive Actions

After presenting the report (which you've already output directly to the conversation), offer these optional actions:

1. **Create Jira ticket** - Generate Jira issue for new failures
2. **Update existing ticket** - Add PR numbers to existing Jira ticket
3. **View detailed logs** - Fetch and display full error context
4. **Save report to file** - Export the report to a file if needed for sharing (markdown or JSON)
5. **Re-trigger jobs** - Suggest re-trigger for infrastructure failures
6. **Mark tests as fixme** - Generate test.fixme annotations for blocking tests

## Error Pattern Library

Reference the CI Medic Guide for known patterns:

### Deployment Phase Errors

| Pattern | Classification | Jira Label | Action |
|---------|---------------|------------|--------|
| `Crunchy Postgres operator failed to create the user` | DEPLOY_POSTGRES | `postgresql-operator` | Check operator version, re-trigger |
| `Failed to reach Backstage after N attempts` | DEPLOY_HEALTH_CHECK | `health-check-timeout` | Check pod logs, resource limits |
| `CrashLoopBackOff` | DEPLOY_POD_CRASH | `deployment-crash` | Investigate pod logs |
| `ImagePullBackOff` | DEPLOY_IMAGE_PULL | `image-registry` | Check registry, rate limits |
| `helm upgrade.*failed` | DEPLOY_HELM | `helm-chart` | Check values, CRDs |
| `Tekton.*timeout` | DEPLOY_OPERATOR | `tekton-operator` | Check operator status |

### Infrastructure Errors

| Pattern | Classification | Action |
|---------|---------------|--------|
| `Cluster pool exhausted` | INFRA_CLUSTER_POOL | Re-trigger, escalate if persistent |
| `failed to acquire lease` | INFRA_LEASE | Re-trigger |
| `no cluster available` | INFRA_NO_CLUSTER | Check cluster pool status |

### Test Failures

| Pattern | Classification | Action |
|---------|---------------|--------|
| `X passed, 0 failed \(retried: Y\)` | TEST_FLAKY | File flaky test ticket |
| `TimeoutError: page.goto` | TEST_TIMEOUT | Check app performance |
| `Error: element not found` | TEST_ASSERTION | Investigate selector changes |

## Important Notes

**CRITICAL - Jira Cloud Requirements:**
- **ALWAYS add time bounds**: Add `updated >= -365d` to JQL queries (Jira Cloud requirement)
- **Base JQL pattern**: `project = RHDHBUGS AND labels = "ci-fail" AND resolution = Unresolved AND updated >= -365d`
- **Match Analysis**: When MCP is available, compare error patterns with ticket summaries/descriptions and calculate match confidence
- **Report Content**: Include actual ticket data (key, summary, status, assignee) when MCP works, or search URLs when it doesn't

**CRITICAL - Report Output:**
- **Output report directly to conversation** - Do NOT write to /tmp and then cat
- Display the full formatted report in your response text
- Only save to file if user explicitly requests it (Step 7, option 4)

**Other Notes:**
- Use pattern matching and regex to extract error signatures
- Implement fuzzy string matching for error similarity (Levenshtein distance ~70% threshold)
- Cache fetched logs to /tmp/ to avoid redundant requests (logs only, not the final report)
- Support both manual PR input and auto-detection of recent failures

## Future Enhancements

- Slack integration: Post triage summary to #rhdh-e2e-alerts
- Auto-create Jira tickets with pre-filled details
- Historical trend analysis: Track failure patterns over time
- ML-based failure prediction: Predict likely cause based on past tickets
- Integration with AI Test Triager for nightly jobs
