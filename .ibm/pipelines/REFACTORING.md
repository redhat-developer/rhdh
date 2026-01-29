# CI Utils Refactoring Status

## Bug Fixes

### Fixed: Missing error handling for deployment creation timeout (2026-01-08)

**Issue**: In `deploy_rhdh_operator()`, when the Backstage deployment wasn't created within the
5-minute timeout, the function only logged a warning (`log::warn`) but continued execution. If the
database resource was later found, the function would return success (0) despite the deployment
never being created, leading to subsequent failures when trying to wait for non-existent pods.

**Root Cause**: Incorrect error handling logic:

```bash
# Before (lines 101-103):
if [[ $waited -eq $max_wait ]]; then
  log::warn "Backstage deployment not found after ${max_wait} checks"
fi
# Continues to database check even if deployment wasn't created!
```

**Solution**: Changed to fail-fast with proper diagnostics:

```bash
# After:
if [[ $waited -eq $max_wait ]]; then
  log::error "Backstage deployment not created after ${max_wait} checks (5 minutes)"
  log::info "Checking Backstage CR status for errors..."
  oc get backstage rhdh -n "$namespace" -o yaml | grep -A 20 "status:" || true
  log::info "Checking operator logs..."
  oc logs -n "${OPERATOR_MANAGER:-rhdh-operator}" -l control-plane=controller-manager --tail=50 || true
  return 1 # Fail immediately - don't check for database
fi
```

**Files Modified**:

- `.ibm/pipelines/install-methods/operator.sh` - `deploy_rhdh_operator()` function (lines 101-108)

**Impact**:

- Deployment failures are now detected immediately (fail-fast)
- Prevents false positives where database exists but deployment doesn't
- Provides diagnostic information (CR status, operator logs) on failure
- Eliminates cascading failures in subsequent wait operations

### Fixed: install-dynamic-plugins init container crash (2026-01-08)

**Issue**: The Backstage deployment never became ready because the `install-dynamic-plugins` init
container immediately crashed with `CrashLoopBackOff`
(`ReplicaSet "backstage-rhdh-7b994b7fcf" has timed out progressing` in the CI logs). Without a
successful init container run, the `backstage-rhdh` pod is never created, and the CI job times out
while waiting for the deployment to be ready.

**Root Cause**: During the refactor we simplified `enable_orchestrator_plugins_op()` to only wait
for the Backstage CR. That removed the logic which:

- waits for the operator-provided default `backstage-dynamic-plugins-*` configmap,
- merges it with the pipeline-provided `dynamic-plugins` content (deduplicating by `package` so that
  custom overrides win),
- reapplies the merged configmap, and
- restarts the Backstage deployment.

As a result, the init container kept reading the unmerged default configmap, failed to install the
required plugin bundles, and the deployment never progressed.

**Solution**: Re-introduced a resilient merge + restart workflow with corrected yq syntax:

```bash
default_cm=$(oc get cm -n "$namespace" | grep "backstage-dynamic-plugins-" | head -1)

# Merge with single-document output (select(di == 0) prevents duplicate YAML docs)
yq eval-all '
  select(fileIndex == 0) as $default |
  select(fileIndex == 1) as $custom |
  {
    "includes": (($default.includes // []) + ($custom.includes // [])) | unique,
    "plugins": (($default.plugins // []) + ($custom.plugins // [])) | group_by(.package) | map(.[-1])
  }
' "$work_dir/default-plugins.yaml" "$work_dir/custom-plugins.yaml" \
  | yq eval 'select(di == 0)' - > "$work_dir/merged-plugins.yaml"

oc apply -f "$work_dir/merged-configmap.yaml" -n "$namespace"
oc rollout restart deployment/"$backstage_deployment" -n "$namespace"
wait_for_deployment "$namespace" "$backstage_deployment" 15
```

**Note**: The `select(di == 0)` filter is critical to prevent `yq eval-all` from outputting multiple
YAML documents, which would cause syntax errors.

**Files Modified**:

- `.ibm/pipelines/utils.sh` – Complete rewrite of `enable_orchestrator_plugins_op()` with merge,
  dedupe, restart, and readiness wait.

**Impact**:

- Restores the behaviour from `origin/main`, ensuring Backstage always uses the merged
  dynamic-plugins configmap expected by our tests.
- Eliminates the `install-dynamic-plugins` CrashLoopBackOff and the downstream 15-minute timeout
  while waiting for `backstage-rhdh`.
- Provides much better logging when the default configmap is missing or merging fails.

### Fixed: Database resource detection supports both PostgresCluster and StatefulSet (2026-01-07)

**Issue**: The RHDH operator can create the database in two different ways:

1. **PostgresCluster** (when Crunchy Postgres operator CRD is available)
2. **StatefulSet** (built-in postgres fallback when CRD is not available)

Our initial implementation only checked for PostgresCluster, causing 5-minute timeouts when the
operator created a StatefulSet instead.

**Root Cause**: The operator's database creation strategy is dynamic:

- If `postgresclusters.postgres-operator.crunchydata.com` CRD exists → creates PostgresCluster
- If CRD doesn't exist or operator decides to use built-in → creates StatefulSet
  `backstage-psql-rhdh`

**Observed Behavior**: In CI logs (21:08:50Z), the operator successfully created:

```
"apps/v1, Kind=StatefulSet": "backstage-psql-rhdh"
```

But our code was only checking for PostgresCluster, resulting in false timeout.

**Solution**: Enhanced detection to support both database resource types:

```bash
# Wait for the operator to create the database resource
# The operator can create either:
# 1. PostgresCluster (if Crunchy operator is used)
# 2. StatefulSet (built-in postgres)
while [[ $psql_waited -lt $psql_wait ]]; do
  # Check for PostgresCluster (Crunchy-based)
  if oc get postgrescluster -n "$namespace" --no-headers 2> /dev/null | grep -q "backstage-psql"; then
    log::success "PostgresCluster 'backstage-psql' created by operator (Crunchy-based)"
    return 0
  fi

  # Check for StatefulSet (built-in postgres)
  if oc get statefulset -n "$namespace" --no-headers 2> /dev/null | grep -q "backstage-psql"; then
    log::success "StatefulSet 'backstage-psql-rhdh' created by operator (built-in postgres)"
    return 0
  fi

  sleep 5
  psql_waited=$((psql_waited + 1))
done
```

**Files Modified**:

- `.ibm/pipelines/install-methods/operator.sh` - `deploy_rhdh_operator()` function (lines 105-138)

**Impact**:

- Supports both PostgresCluster (Crunchy) and StatefulSet (built-in) database types
- Eliminates false timeouts when operator uses StatefulSet
- Provides clear logging about which database type was created
- Enhanced diagnostics show both resource types on failure

**Note**: PostgresCluster CRD verification is still performed before applying Backstage CR to ensure
the operator has the option to use Crunchy if desired.

### Fixed: Missing error propagation in enable_orchestrator_plugins_op (2026-01-06)

**Issue**: The `enable_orchestrator_plugins_op()` function was calling
`wait_for_backstage_resource()` without checking its return value. If the wait timed out and
returned 1, the function would still log success and return 0, causing deployment to proceed with
potentially unconfigured orchestrator plugins.

**Solution**: Added proper error checking with `|| return 1`:

```bash
# Before:
wait_for_backstage_resource "$namespace"
log::info "Backstage resource is ready..." # Always logged, even on failure!

# After:
if ! wait_for_backstage_resource "$namespace"; then
  log::error "Failed to find backstage resource in namespace: $namespace"
  return 1
fi
log::info "Backstage resource is ready..." # Only logged on success
```

**Files Modified**:

- `.ibm/pipelines/utils.sh` - `enable_orchestrator_plugins_op()` function (lines 1687-1690)

**Impact**: Deployment will now fail fast if Backstage resource is not found, preventing silent
failures.

### Fixed: Sonataflow database creation job timeout (2026-01-06)

**Issue**: Job `rhdh-rbac-create-sonataflow-database` failing with `DeadlineExceeded` after 120
seconds, causing Sonataflow platform pods to crash.

**Root Cause**: The Helm install was creating the database creation job immediately, but the
external PostgreSQL pod wasn't fully ready to accept connections yet. The job's init container would
timeout trying to connect to the database.

**Solution**: Added explicit wait for PostgreSQL deployment to be ready before performing Helm
install:

```bash
# Wait for PostgreSQL to be fully ready before deploying RBAC instance
k8s_wait::deployment "${NAME_SPACE_POSTGRES_DB}" "postgress-external-db" 10 10
```

**Files Modified**:

- `.ibm/pipelines/utils.sh` - `rbac_deployment()` function

**Expected Result**: PostgreSQL is confirmed ready before the database creation job runs,
eliminating connection timeouts.

### Fixed: Operator deployment race condition (2026-01-06)

**Issue**: Function `deploy_orchestrator_workflows_operator()` failing because `backstage-psql` pod
doesn't exist after 15 minutes.

**Root Cause**: The `deploy_rhdh_operator()` function was applying the Backstage CR and returning
immediately, without waiting for the operator to create the deployment and pods. The next function
(`deploy_orchestrator_workflows_operator()`) would start immediately and fail because the pods
hadn't been created yet.

**Solution**: Enhanced `deploy_rhdh_operator()` to wait for the operator to create the Backstage
deployment before returning:

```bash
# Wait up to 5 minutes for operator to create deployment
while ! oc get deployment -n "$namespace" | grep -q "backstage-"; do
  sleep 5
done
```

**Files Modified**:

- `.ibm/pipelines/install-methods/operator.sh` - `deploy_rhdh_operator()` function

**Expected Result**: The operator has time to create deployments/pods before subsequent functions
try to interact with them.

### Fixed: Incorrect assumption about operator-created configmap (2026-01-06)

**Issue**: Function `enable_orchestrator_plugins_op()` was waiting for a
`backstage-dynamic-plugins-*` configmap that never gets created.

**Root Cause**: The Backstage CR specifies `dynamicPluginsConfigMapName: dynamic-plugins`, which
tells the operator to use our custom configmap instead of creating its own default one. The function
was incorrectly assuming the operator would create a `backstage-dynamic-plugins-*` configmap to
merge with.

**Solution**: Simplified the function to just wait for the Backstage resource to be ready, since the
orchestrator plugins are already configured in the `dynamic-plugins` configmap that we create
upfront.

**Before** (incorrect):

- Wait for operator to create `backstage-dynamic-plugins-*` configmap (never happens)
- Merge custom + default plugins
- Apply merged configmap
- Restart deployment

**After** (correct):

- Wait for Backstage resource to exist
- Plugins are already configured correctly in pre-created configmap
- No merge or restart needed

**Files Modified**:

- `.ibm/pipelines/utils.sh` - `enable_orchestrator_plugins_op()` function (simplified from 100+
  lines to ~20 lines)

**Expected Result**: Function completes in seconds instead of timing out after 2.5 minutes.

### Fixed: Plugin merge logic causing Backstage deployment timeout (2026-01-05) [OBSOLETE]

**Issue**: Backstage deployment consistently timing out after 16 minutes when orchestrator plugins
are enabled in OCP Operator jobs.

**Root Cause**: The `enable_orchestrator_plugins_op()` function was forcing ALL default plugins to
`disabled: false`, which:

- Enabled plugins that should remain disabled
- Created potential conflicts between plugins
- Overloaded the Backstage initialization process

**Previous Logic** (problematic):

```bash
# Forced all default plugins to enabled
yq eval '.plugins | map(. + {"disabled": false})'
```

**New Logic** (fixed):

```bash
# Intelligently merge: custom plugins + non-conflicting default plugins
# Preserves operator's default plugin states
yq eval-all 'custom.plugins + (default.plugins | filter not in custom)'
```

**Files Modified**:

- `.ibm/pipelines/utils.sh` - `enable_orchestrator_plugins_op()` function (lines 1722-1737)

**Expected Result**: Backstage should start successfully with only the necessary plugins enabled,
respecting the operator's default configuration.

### Improved: Enhanced deployment timeout diagnostics (2026-01-05)

**Issue**: When deployments timeout after 15 minutes, there was no diagnostic information to
understand why the pod failed to start.

**Improvement**: Enhanced `k8s_wait::deployment()` function to collect and display diagnostic
information when timeout occurs:

- Pod status and description
- Pod logs (last 50 lines)
- Recent events related to the resource

**Files Modified**:

- `.ibm/pipelines/lib/k8s-wait.sh` - `k8s_wait::deployment()` function

**Benefit**: Faster troubleshooting by providing immediate diagnostic information in CI logs instead
of requiring manual cluster access.

### Fixed: enable_orchestrator_plugins_op timing issue in OCP Operator jobs (2026-01-02)

**Issue**: OCP Operator job failing with error:

```
Error: No default configmap found matching pattern 'backstage-dynamic-plugins-'
```

**Root Cause**: The `enable_orchestrator_plugins_op()` function was being called immediately after
creating the Backstage CR, but the RHDH operator needs time to create the default
`backstage-dynamic-plugins-*` configmap. The function was failing because it tried to find this
configmap before the operator had created it.

**Fix Applied**:

1. Added a polling loop to wait for the configmap to be created (max 2.5 minutes)
2. Added better error reporting showing available configmaps if the wait times out
3. Improved logging to show progress during the wait

**Files Modified**:

- `.ibm/pipelines/utils.sh` - `enable_orchestrator_plugins_op()` function (lines 1689-1715)

**Testing**: No linter errors after fix. The function now waits up to 2.5 minutes for the operator
to create the configmap.

### Fixed: readonly variable error for OPENSHIFT_OPERATORS_NAMESPACE (2026-01-02)

**Issue**: CI pipeline failing with error:

```
/tmp/rhdh/.ibm/pipelines/utils.sh: line 9: OPENSHIFT_OPERATORS_NAMESPACE: readonly variable
```

**Root Cause**: During the refactoring, a constant was renamed from `OPENSHIFT_OPERATORS_NAMESPACE`
to `OPERATOR_NAMESPACE` in `lib/operators.sh`, but `utils.sh` was still trying to declare the old
variable name. Since `lib/operators.sh` declares `OPERATOR_NAMESPACE` as readonly, and the variable
wasn't properly migrated in `utils.sh`, this caused a conflict.

**Fix Applied**:

1. Removed the declaration of `OPENSHIFT_OPERATORS_NAMESPACE` from `utils.sh` (line 9)
2. Added sourcing of `lib/operators.sh` and `lib/k8s-wait.sh` in `utils.sh` header
3. Updated all references from `${OPENSHIFT_OPERATORS_NAMESPACE}` to `${OPERATOR_NAMESPACE}` in
   `utils.sh`:
   - Line 958: `cluster_setup_ocp_helm()` function
   - Line 976: `cluster_setup_ocp_operator()` function

**Files Modified**:

- `.ibm/pipelines/utils.sh`

**Testing**: No linter errors after fix.

## Completed

### Modular Architecture

Utility functions extracted from `utils.sh` into organized modules in `lib/`:

- `lib/log.sh` - Logging functions (147 LOC)
- `lib/common.sh` - Common utilities (104 LOC)
- `lib/k8s-wait.sh` - Kubernetes wait operations (321 LOC)
- `lib/operators.sh` - Operator installations (263 LOC)

Total: 835 LOC extracted into modules.

### Functions Migrated (20 total)

**Common utilities (4):**

- `oc_login` → `common::oc_login`
- `is_openshift` → `common::is_openshift`
- `sed_inplace` → `common::sed_inplace`
- `get_previous_release_version` → `common::get_previous_release_version`

**Kubernetes wait (5):**

- `wait_for_deployment` → `k8s_wait::deployment`
- `wait_for_job_completion` → `k8s_wait::job`
- `wait_for_svc` → `k8s_wait::service`
- `wait_for_endpoint` → `k8s_wait::endpoint`
- `wait_for_backstage_resource` → `k8s_wait::backstage_resource`

**Operators (11):**

- `install_subscription` → `operator::install_subscription`
- `check_operator_status` → `operator::check_status`
- `install_crunchy_postgres_ocp_operator` → `operator::install_postgres_ocp`
- `install_crunchy_postgres_k8s_operator` → `operator::install_postgres_k8s`
- `install_serverless_logic_ocp_operator` → `operator::install_serverless_logic`
- `install_serverless_ocp_operator` → `operator::install_serverless`
- `install_pipelines_operator` → `operator::install_pipelines`
- `install_tekton_pipelines` → `operator::install_tekton`
- `delete_tekton_pipelines` → `operator::delete_tekton`
- `install_olm` → `operator::install_olm`
- `uninstall_olm` → `operator::uninstall_olm`

### Code Reduction

- `utils.sh`: 1,631 lines → 1,175 lines (-456 lines, -28%)
- Removed duplicate function definitions
- No backward compatibility shims (direct migration)

### Updated Files

- `.ibm/pipelines/utils.sh` - Imports modules, uses new function names
- `.ibm/pipelines/jobs/*.sh` (5 files) - Updated to use `common::oc_login`
- `.ibm/pipelines/README.md` - Added development guidelines and modular architecture
- `.ibm/pipelines/lib/README.md` - Module documentation and conventions

### Quality

- Shellcheck: 0 warnings
- Prettier: All files formatted
- No breaking changes (all call sites updated)

## Pending

### High Priority

#### `lib/helm.sh` (6 functions, ~150 LOC)

Functions to extract:

- `yq_merge_value_files` → `helm::merge_values`
- `get_image_helm_set_params` → `helm::get_image_params`
- `perform_helm_install` → `helm::install`
- `uninstall_helmchart` → `helm::uninstall`
- `get_chart_version` → `helm::get_chart_version`
- `get_previous_release_value_file` → `helm::get_previous_release_values`

Risk: Medium (complex yq merge logic)

#### `lib/config.sh` (3 functions, ~40 LOC)

Functions to extract:

- `create_app_config_map` → `config::create_app_config_map`
- `select_config_map_file` → `config::select_config_map_file`
- `create_dynamic_plugins_config` → `config::create_dynamic_plugins_config`

Risk: Low (isolated logic)

### Medium Priority

#### `lib/namespace.sh` (7 functions, ~100 LOC)

Functions to extract:

- `configure_namespace` → `namespace::configure`
- `delete_namespace` → `namespace::delete`
- `force_delete_namespace` → `namespace::force_delete`
- `remove_finalizers_from_resources` → `namespace::remove_finalizers`
- `setup_image_pull_secret` → `namespace::setup_pull_secret`
- `create_secret_dockerconfigjson` → `namespace::create_secret_dockerconfigjson`
- `add_image_pull_secret_to_namespace_default_serviceaccount` → `namespace::add_pull_secret`

Risk: High (destructive operations - handle carefully)

#### `lib/database.sh` (1 function, ~21 LOC)

Functions to extract:

- `configure_external_postgres_db` → `database::configure_external_postgres`

Risk: Low

#### `lib/deployment.sh` (19 functions, ~336 LOC)

Functions to extract:

- `apply_yaml_files`
- `create_conditional_policies_operator`
- `prepare_operator_app_config`
- `deploy_test_backstage_customization_provider`
- `deploy_redis_cache`
- `base_deployment`
- `rbac_deployment`
- `initiate_deployments`
- `base_deployment_osd_gcp`
- `rbac_deployment_osd_gcp`
- `initiate_deployments_osd_gcp`
- `initiate_upgrade_base_deployments`
- `initiate_upgrade_deployments`
- `initiate_runtime_deployment`
- `initiate_sanity_plugin_checks_deployment`

Risk: Medium (orchestration logic)

### Low Priority (Complex - Extract Last)

#### `lib/orchestrator.sh` (8 functions, ~313 LOC)

Functions to extract:

- `deploy_orchestrator_workflows` → `orchestrator::deploy_workflows`
- `deploy_orchestrator_workflows_operator` → `orchestrator::deploy_workflows_operator`
- `enable_orchestrator_plugins_op` → `orchestrator::enable_plugins`
- `install_orchestrator_infra_chart` → `orchestrator::install_infra`
- `cluster_setup_ocp_helm` → `orchestrator::setup_ocp_helm`
- `cluster_setup_ocp_operator` → `orchestrator::setup_ocp_operator`
- `cluster_setup_k8s_operator` → `orchestrator::setup_k8s_operator`
- `cluster_setup_k8s_helm` → `orchestrator::setup_k8s_helm`

Risk: High (complex state management, 133 LOC in largest function)

#### `lib/testing.sh` (5 functions, ~160 LOC)

Functions to extract:

- `run_tests`
- `check_backstage_running`
- `check_and_test`
- `check_upgrade_and_test`
- `check_helm_upgrade`

Risk: Medium (E2E orchestration)

## Remaining in utils.sh

After all extractions, `utils.sh` should contain:

- Module imports (lib/log.sh, lib/common.sh, etc.)
- Pod log retrieval functions (retrieve_pod_logs, save_all_pod_logs)
- Any pipeline-specific orchestration that doesn't fit modules

Estimated final size: ~200-300 LOC (from current 1,175)

## Next Steps

1. Extract `lib/helm.sh` and `lib/config.sh` (low-risk, high-value)
2. Extract `lib/database.sh` and `lib/deployment.sh` (medium complexity)
3. Extract `lib/namespace.sh` (carefully - destructive operations)
4. Extract `lib/orchestrator.sh` and `lib/testing.sh` (complex - last)
5. Update all call sites to use new module functions
6. Final cleanup: Remove any remaining duplicate code

## References

- `lib/README.md` - Module conventions and structure
- `docs/ci-utils-audit.md` - Complete function inventory
- `ci.plan.md` - Original refactoring plan
