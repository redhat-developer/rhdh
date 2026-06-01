## Summary

- Remove E2E tests for remaining migrated plugins (Bulk Import, Orchestrator, Extensions) from the [rhdh-plugin-export-overlays](https://github.com/redhat-developer/rhdh-plugin-export-overlays) repository (Phase 3 — [RHIDP-8841](https://redhat.atlassian.net/browse/RHIDP-8841))
- Removes 13 spec files, their exclusive page objects/utils/test data, all Orchestrator CI infrastructure (scripts, operators, SonataFlow setup), and plugin entries from Helm values files, ConfigMaps, and RBAC policies
- **44 files changed, ~6,398 lines removed**

Jira: [RHIDP-13952](https://redhat.atlassian.net/browse/RHIDP-13952)

## Tests Removed

| Test | Files Deleted | Config Removed |
|------|---------------|----------------|
| **Orchestrator** (9 specs) | `failswitch-workflow.spec.ts`, `greeting-workflow.spec.ts`, `orchestrator-rbac.spec.ts`, `orchestrator-entity-rbac.spec.ts`, `orchestrator-entity-workflows.spec.ts`, `retry-workflow.spec.ts`, `token-propagation-workflow.spec.ts`, `ui-props-test-workflow.spec.ts`, `workflow-all-runs-validations.spec.ts`, `orchestrator.ts` (page object), `orchestrator-rbac-helper.ts` (API helper) | 4 OCI plugin entries from `values_showcase.yaml` + `values_showcase-rbac.yaml`; `orchestrator:` SonataFlow config sections; entity-workflow templates from `app-config-rhdh.yaml` + `app-config-rhdh-rbac.yaml`; `- orchestrator` from `pluginsWithPermission`; full "Orchestrator Entity-Workflow RBAC" section from `rbac-policy.csv`; `testIgnore` entries from 6 Playwright projects; orchestrator disable overrides from 6 `diff-values_showcase*.yaml` files |
| **Bulk Import** | `bulk-import.spec.ts`, `bulk-import.ts` (page object), `bulk-import.ts` (test data) | 2 wrapper plugin entries from `values_showcase.yaml` + `values_showcase-rbac.yaml`; `bulkImport:` config + catalog URL from `app-config-rhdh-rbac.yaml`; `bulk_import` role from `rbac-policy.csv`, `rbac-constants.ts`, and `authentication-providers/yamls/rbac-policy.csv`; `testIgnore` entries from Playwright config |
| **Extensions** | `extensions.spec.ts`, `extensions.ts` (page object) | 3 wrapper plugin entries from `values_showcase.yaml` + `values_showcase-rbac.yaml`; `extensions:` config from `app-config-rhdh.yaml`; `extension` role from `rbac-policy.csv` + `rbac-constants.ts`; `extensions-catalog` volume mount + volume from `values_showcase-rbac.yaml` + 6 `diff-values_showcase-rbac_*.yaml` files |

## CI Infrastructure Removed

- **`.ci/pipelines/lib/orchestrator.sh`** — entire file deleted (SonataFlow deployment, workflow management, plugin enablement functions)
- **`.ci/pipelines/lib/operators.sh`** — removed `operator::install_serverless_logic()` and `operator::install_serverless()` (SonataFlow/Knative operator installs)
- **`.ci/pipelines/utils.sh`** — removed all orchestrator delegation functions (`should_skip_orchestrator`, `deploy_orchestrator_workflows`, `enable_orchestrator_plugins_op`, `install_orchestrator_infra_chart`, `disable_orchestrator_plugins_in_values`); simplified `base_deployment()`, `rbac_deployment()`, `cluster_setup_ocp_helm()`, `cluster_setup_ocp_operator()` by removing orchestrator conditional logic; removed serverless operator installs from `cluster_setup_ocp_operator()`
- **`.ci/pipelines/jobs/upgrade.sh`** — removed `deploy_orchestrator_workflows` call
- **`.ci/pipelines/jobs/ocp-operator.sh`** — removed commented-out orchestrator deployment calls and "(orchestrator disabled)" log messages
- **`.ci/pipelines/jobs/ocp-nightly.sh`** — removed "(orchestrator disabled)" log messages
- **`diff-values_showcase_PR.yaml`**, **`diff-values_showcase-rbac_PR.yaml`**, **`diff-values_showcase_upgrade.yaml`**, **`diff-values_showcase_OSD-GCP.yaml`**, **`diff-values_showcase-rbac_OSD-GCP.yaml`** — cleared orchestrator override content
- **`diff-values_showcase-sanity-plugins.yaml`** — removed `orchestrator: enabled` section
- **`diff-values_showcase_{AKS,EKS,GKE}.yaml`** — removed orchestrator plugin disable entries and `orchestrator: null`
- **`diff-values_showcase-rbac_{AKS,EKS,GKE}.yaml`** — removed orchestrator plugin disable entries, `extensions-catalog` volume mounts/volumes, and `orchestrator: null`

## Documentation Updated

- **`docs/e2e-tests/CI-medic-guide.md`** — removed 5 stale references to orchestrator infrastructure, `orchestrator.sh`, and orchestrator workflow steps
- **`.ci/pipelines/lib/README.md`** — removed `orchestrator.sh` module section and stale serverless function references

## Shared Dependencies Preserved

- **Keycloak catalog backend** (`backstage-community-plugin-catalog-backend-module-keycloak-dynamic`) kept — still required by remaining tests
- **`catalog.providers.keycloakOrg`** kept in both app-config files
- **`KEYCLOAK_AUTH_*` env vars** kept — used by OIDC auth provider
- **RBAC support files** (`rbac-api.ts`, `rbac.ts`, `rbac-constants.ts`, `rhdh-auth-api-hack.ts`) kept — still used by `auditor-rbac.spec.ts` and other remaining tests
- **`home-page-customization.spec.ts`** retained with Quick Access verification

## Test plan

- [ ] OCP Helm PR job (`showcase` + `showcase-rbac`) — validates deployment with removed plugins and remaining tests pass
- [ ] OCP Helm Nightly job — validates `showcase-sanity-plugins`, localization, and runtime
- [ ] OCP Operator job — validates `showcase-operator` + `showcase-operator-rbac`
