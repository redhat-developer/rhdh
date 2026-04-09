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

Ask the user which PRs or jobs they want to analyze. Accept any of these formats:

- **PR numbers**: `4537`, `4418`, `4501`
- **Job URLs**: Full Prow job URLs
- **Natural language**: "check the last 5 failed PR checks", "analyze ocp-helm failures today"
- **Keywords**: "all failed", "recent failures", "release-1.8 failures"

### Auto-detection Mode

If the user says "recent failures" or "check failed PRs", fetch recent failures:

```bash
# Fetch recent PR jobs from Prow
curl -s 'https://prow.ci.openshift.org/prowjobs.js?job=pull-ci-redhat-developer-rhdh-*-e2e-*' | \
  jq -r '.items[] | select(.status.state == "failure") | "\(.spec.refs.pulls[0].number)|\(.spec.job)|\(.status.url)"' | \
  head -20
```

Present as a table and let the user select which ones to analyze.

## Step 2: Fetch Build Logs

For each PR/job, construct the GCS URL and fetch the build log:

**URL Pattern:**
```
https://storage.googleapis.com/test-platform-results/pr-logs/pull/redhat-developer_rhdh/{PR_NUMBER}/{JOB_NAME}/{BUILD_ID}/build-log.txt
```

**How to find the BUILD_ID:**

Option A: Extract from Prow job URL (if provided)
```
https://prow.ci.openshift.org/view/gs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/4537/pull-ci-redhat-developer-rhdh-release-1.8-e2e-ocp-helm/2041819081065107456/build-log.txt
                                                                                                                                           ^^^^^^^^^^^^^^^^^^^^^
```

Option B: Query Prow API for latest build ID
```bash
gh api --method GET https://prow.ci.openshift.org/prowjobs.js \
  -F job="pull-ci-redhat-developer-rhdh-{BRANCH}-e2e-{PLATFORM}-{METHOD}" \
  -F pull={PR_NUMBER} | \
  jq -r '.items[0].status.build_id'
```

Option C: List directory to find latest build
```bash
# Use gcsweb or gsutil to list builds for the PR
curl -s "https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pr-logs/pull/redhat-developer_rhdh/{PR_NUMBER}/" | \
  grep -oP 'pull-ci-redhat-developer-rhdh[^"]+' | sort -u
```

**Fetch the log:**
```bash
curl -s "https://storage.googleapis.com/test-platform-results/pr-logs/pull/redhat-developer_rhdh/{PR_NUMBER}/{JOB_NAME}/{BUILD_ID}/build-log.txt"
```

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
grep -A 5 "❌\|Error\|FAIL\|Failed" build-log.txt | head -20

# Find which namespace failed
grep -oP "namespace:\s*\K[^\s]+" build-log.txt

# Find Playwright project
grep -oP "playwright test --project=\K[^\s]+" build-log.txt
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

**IMPORTANT:** Check if Jira MCP tools are available first. If available, use them for authenticated access.

### Option A: Use Jira MCP (Preferred - when available)

**⚠️ Note:** After adding MCP server with `claude mcp add`, you must **restart Claude Code** for the tools to become available.

Check for available MCP tools with:
```
ToolSearch(query: "jql", max_results: 10)
```

If Jira MCP is configured and loaded, use these tools:

```bash
# Search for all ci-fail tickets in RHDHBUGS project
jql_search(
  jql: 'project = RHDHBUGS AND labels = "ci-fail" AND resolution = Unresolved ORDER BY created DESC',
  maxResults: 20,
  fields: ["key", "summary", "status", "created", "description"]
)

# Semantic search for specific error patterns
jql_search(
  jql: 'project = RHDHBUGS AND labels = "ci-fail" AND text ~ "PostgreSQL operator"',
  maxResults: 10
)

jql_search(
  jql: 'project = RHDHBUGS AND labels = "ci-fail" AND summary ~ "Adoption Insights"',
  maxResults: 10
)

# Get specific issue details
get_issue(
  issueIdOrKey: "RHDHBUGS-1234",
  fields: ["summary", "description", "status", "created", "assignee"]
)
```

**MCP Setup:** If Jira MCP is not available or tools not loaded, guide the user to set it up:

1. **Get API token:** https://id.atlassian.com/manage-profile/security/api-tokens
   - Click "Create API token"
   - Name: "Claude Code - PR Triage"
   - Copy the token

2. **Add Jira MCP server using Claude Code CLI:**
   ```bash
   claude mcp add jira \
     -e JIRA_INSTANCE_URL=https://redhat.atlassian.net \
     -e JIRA_USER_EMAIL=your.email@redhat.com \
     -e JIRA_API_KEY=your-api-token \
     -- npx -y jira-mcp
   ```

3. **Verify installation:**
   ```bash
   claude mcp list
   # Should show: jira: npx -y jira-mcp - ✓ Connected
   ```

4. **Restart Claude Code** to load the MCP tools

After restart, check with: `ToolSearch(query: "jql", max_results: 5)`

### Option B: Fallback Methods (when MCP unavailable)

**Fallback 1 - Direct Jira REST API (v3):**

⚠️ **Important:** Red Hat Jira requires API v3 (v2 is deprecated).

```bash
# Basic search for ci-fail tickets in RHDHBUGS project
curl -s -u "${JIRA_USER}:${JIRA_TOKEN}" \
  "https://redhat.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20resolution%20%3D%20Unresolved%20ORDER%20BY%20created%20DESC&maxResults=15&fields=key,summary,status,created,description" | \
  jq -r '.issues[] | "\(.key)|\(.fields.summary)|\(.fields.status.name)|\(.fields.created[0:10])"'

# Search for specific error patterns
curl -s -u "${JIRA_USER}:${JIRA_TOKEN}" \
  "https://redhat.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20text%20~%20%22PostgreSQL%20operator%22&maxResults=10&fields=key,summary,status" | \
  jq -r '.issues[] | "\(.key)|\(.fields.summary)|\(.fields.status.name)"'

# Search by summary text
curl -s -u "${JIRA_USER}:${JIRA_TOKEN}" \
  "https://redhat.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20summary%20~%20%22Adoption%20Insights%22&maxResults=10&fields=key,summary,status" | \
  jq -r '.issues[] | "\(.key)|\(.fields.summary)|\(.fields.status.name)"'
```

**Key API v3 differences:**
- Endpoint: `/rest/api/3/search/jql` (not `/rest/api/2/search`)
- Use `fields` parameter to specify which fields to retrieve
- Always include `project = RHDHBUGS` filter for RHDH-specific tickets

**Fallback 2 - Manual Jira web search:**
Provide user with direct links and search terms to check manually:
- [All ci-fail tickets](https://redhat.atlassian.net/issues/?jql=project%20%3D%20RHDHBUGS%20AND%20labels%20%3D%20%22ci-fail%22%20AND%20resolution%20%3D%20Unresolved%20ORDER%20BY%20created%20DESC)

### Semantic Matching

For each detected failure, search for similar Jira tickets:

1. Extract key terms from error message
2. Search Jira ticket summaries and descriptions
3. Use fuzzy matching on error patterns
4. Consider these as "similar":
   - Same error message substring (>70% match)
   - Same failure phase + namespace
   - Same Playwright project failures

**Example:**
```
Detected: "Crunchy Postgres operator failed to create the user"

Searching Jira...
Found: RHDHBUGS-1234 "PostgreSQL operator user creation timeout"
Similarity: 85% (high confidence match)
```

## Step 6: Generate Triage Report

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
├─ 💬 Error Message:
│   {ERROR_MESSAGE}
└─ 📝 Stack Trace (first 10 lines):
    {STACK_TRACE}

[Repeat for each PR]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎫 JIRA TICKET ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Group 1: PostgreSQL Operator User Creation Failure
├─ Existing Ticket: RHDHBUGS-1234 (Open)
├─ Title: "PostgreSQL operator user creation timeout"
├─ URL: https://redhat.atlassian.net/browse/RHDHBUGS-1234
├─ Match Confidence: 85%
├─ Status: Open
├─ Assigned: @team-member
└─ Recommendation: ✅ Use existing ticket (update with new PR numbers)

Group 2: {PATTERN_NAME}
├─ Existing Ticket: None found
├─ Recommendation: ⚠️  Create new Jira ticket
└─ Suggested Title: "{AUTO_GENERATED_TITLE}"

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
```

## Step 7: Interactive Actions

After presenting the report, offer these actions:

1. **Create Jira ticket** - Generate Jira issue for new failures
2. **Update existing ticket** - Add PR numbers to existing Jira ticket
3. **View detailed logs** - Fetch and display full error context
4. **Export report** - Save report to file (markdown or JSON)
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

## Reference Links

- **CI Medic Guide:** `docs/e2e-tests/CI-medic-guide.md`
- **Jira Dashboard:** https://redhat.atlassian.net/issues/?jql=labels%20%3D%20%22ci-fail%22%20AND%20resolution%20%3D%20Unresolved%20ORDER%20BY%20created%20DESC
- **Prow PR Jobs:** https://prow.ci.openshift.org/?job=pull-ci-redhat-developer-rhdh-*-e2e*
- **Job History:** https://prow.ci.openshift.org/job-history/gs/test-platform-results/pr-logs/directory/pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm
- **GCS Artifacts:** https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pr-logs/

## Implementation Notes

- Use WebFetch tool to fetch build logs from GCS URLs
- Use pattern matching and regex to extract error signatures
- Implement fuzzy string matching for error similarity (Levenshtein distance ~70% threshold)
- Cache fetched logs to avoid redundant requests
- Handle rate limiting on Jira/GitHub API calls
- Support both manual PR input and auto-detection of recent failures
- Save report to file for sharing with team

## Future Enhancements

- Slack integration: Post triage summary to #rhdh-e2e-alerts
- Auto-create Jira tickets with pre-filled details
- Historical trend analysis: Track failure patterns over time
- ML-based failure prediction: Predict likely cause based on past tickets
- Integration with AI Test Triager for nightly jobs
