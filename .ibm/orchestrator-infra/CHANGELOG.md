# Changelog - Orchestrator Infrastructure

## Recent Fixes

### 2025-10-28 - Logic Operator Installation Fix

**Problem**: The Logic Operator CSV was showing `Failed` state and no controller pod was being created, preventing the SonataFlowPlatform from being processed.

**Root Cause**: The OperatorGroup was configured with `targetNamespaces`, which put the operator in `OwnNamespace` mode. However, the Logic Operator only supports `AllNamespaces` mode.

**Solution**:
1. **Renamed OperatorGroup**: Changed from `openshift-serverless-logic` to `global-operators` to follow conventions
2. **Enabled AllNamespaces mode**: Kept empty `spec: {}` to enable AllNamespaces installation mode
3. **Enhanced wait conditions**: Added explicit wait for Logic Operator controller pod to be ready
4. **Improved error handling**: Better detection and reporting of operator installation status

**Files Modified**:
- `.ibm/orchestrator-infra/roles/deploy-rhdh/tasks/install-orchestrator-infra.yaml`
  - Fixed OperatorGroup configuration
  - Added controller pod readiness check
  - Added `dbMigrationStrategy` to SonataFlow Platform config
  - Improved wait conditions for all deployments

**Commits**:
- `bfd7b162` - docs: update README with troubleshooting
- `07173c72` - fix: configure OperatorGroup correctly for Logic Operator
- Previous commits: Multiple iterations fixing operator installation

**Verification**:
```bash
# CSV should show Succeeded
oc get csv -n openshift-serverless-logic

# Controller pod should be running
oc get pods -n openshift-serverless-logic

# CRDs should be available
oc get crd sonataflowplatforms.sonataflow.org

# SonataFlowPlatform should be Ready
oc get sonataflowplatform -n orchestrator-infra
```

## Previous Changes

### Namespace Configuration Fix
- Fixed `rhdh_ns` variable precedence to ensure deployment to `orchestrator-infra` namespace
- Removed conflicting `vars_files` that was overwriting namespace variable

### PostgreSQL Job Wait Fix
- Added `app: init-orchestrator-db` label to Job
- Updated wait command to use the new label
- Increased timeout from 60s to 120s

### Cleanup
- Removed unused Ansible roles from flight-path-auto-tests base project
- Removed unnecessary repository cloning in workflow deployment script

