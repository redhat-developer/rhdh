# RHDH Plugin Quality Requirements by Support Level

**Epic**: RHIDP-13497 — Plugin Testing by Support Level  
**Author**: Gustavo Lira e Silva  
**Date**: 2026-06-17 (updated 2026-07-24)  
**Status**: PROPOSED (pending team review)

## Document Governance

- **Canonical location**: This document in the `rhdh` repository (`docs/testing-requirements-matrix.md`)
- **Owner**: Quality Engineering
- **Review cadence**: Each major RHDH release
- **Change process**: PR to this repository, reviewed by Quality team
- **Referenced from**: RHDH Plugin Ecosystem Workflow — row 5.0 (Quality)
- **Jira epic**: [RHIDP-13497](https://issues.redhat.com/browse/RHIDP-13497)

## Executive Summary

This document defines differentiated testing requirements for RHDH plugins based on their support level. GA plugins receive full test coverage across all layers; Tech-Preview gets selective coverage; Community gets load/sanity checks only.

**Key principle**: Testing rigor scales with support commitment.

## Support Level Definitions

| Level | Description | Commitment | Workspaces |
|-------|-------------|------------|------------|
| **Generally Available (GA)** | Production-ready, fully supported by Red Hat | Full support, SLA-backed | 17 |
| **Tech Preview (TP)** | Beta quality, not production-ready | Limited support, no SLA | 7 |
| **Community** | Community-maintained | No Red Hat support | 40 |
| **Dev Preview** | Experimental, under active development | No support, may change | 6 |

**Total**: 70 workspaces across 4 support levels (some workspaces contain packages at multiple support levels).

**Source of truth**: Support levels are defined in `rhdh-plugin-export-overlays/workspaces/*/metadata/*.yaml` (`spec.support` field).

## Test Layer Definitions

| Layer | Type | Scope | Tools | Execution Time |
|-------|------|-------|-------|----------------|
| **Layer 1** | Unit Tests | Individual functions, pure logic | Jest, Vitest | Seconds |
| **Layer 2** | Integration Tests | Multiple modules, mocked external deps | Jest + mocks | Seconds to minutes |
| **Layer 3** | Component Tests | React components, test backend | RTL, startTestBackend | Minutes |
| **Layer 4** | E2E Tests | Full system, real cluster | Playwright, K8s/OCP | Minutes to hours |

---

## Testing Requirements Matrix

### GA (Generally Available) — FULL COVERAGE

| Requirement | Minimum | Target | Enforcement |
|-------------|---------|--------|-------------|
| **Layer 1 (Unit)** | 60% coverage | 80% coverage | Required for release |
| **Layer 2 (Integration)** | 40% coverage | 60% coverage | Required for release |
| **Layer 3 (Component)** | Critical paths | All user flows | Recommended |
| **Layer 4 (E2E)** | Smoke tests | Critical user journeys | Required for release |
| **Code review** | 2 approvals | — | Required |
| **Security scan** | No high/critical CVEs | — | Blocks release |
| **Performance** | No regressions | — | Monitored |

**Quality gates**:
- PR cannot merge without passing Layer 1-2 tests
- Release cannot ship without E2E smoke tests passing
- Coverage drop > 5% triggers review

**Current state** (verified 2026-07-24 against overlay repo metadata):
- 14/17 GA workspaces have E2E tests (82%)
- GA gaps: `apiconnect`, `dynatrace-dql`, `scaffolder-backend-module-regex`
- All 5 RHDH-owned GA workspaces have both E2E and unit tests
- Codecov components configured with support-level grouping

#### GA Workspace E2E Coverage Detail

| GA Workspace | E2E | Smoke | Unit Tests (rhdh-plugins) | Owner |
|---|---|---|---|---|
| adoption-insights | Yes | — | 53 files | RHDH Eng |
| analytics | Yes | Yes | upstream | upstream |
| apiconnect | **No** | Yes | upstream | upstream |
| backstage | Yes | Yes | upstream | upstream |
| dynatrace-dql | **No** | Yes | upstream | upstream |
| global-header | Yes | — | 27 files | RHDH Eng |
| homepage | Yes | — | 26 files | RHDH Eng |
| keycloak | Yes | Yes | upstream | upstream |
| lightspeed | Yes | Yes | upstream | upstream |
| orchestrator | Yes | Yes | 105 files | RHDH Eng |
| quickstart | Yes | — | 17 files | RHDH Eng |
| rbac | Yes | — | upstream | upstream |
| roadie-backstage-plugins | Yes | Yes | upstream | upstream |
| scaffolder-backend-module-kubernetes | Yes | — | upstream | upstream |
| scaffolder-backend-module-regex | **No** | **No** | upstream | upstream |
| tech-radar | Yes | Yes | upstream | upstream |
| topology | Yes | — | upstream | upstream |

**Summary**: 14/17 GA workspaces have E2E tests (82%). 3 gaps remain, all upstream/3rd-party owned.

---

### Tech Preview — SELECTIVE COVERAGE

| Requirement | Minimum | Target | Enforcement |
|-------------|---------|--------|-------------|
| **Layer 1 (Unit)** | 40% coverage | 60% coverage | Recommended |
| **Layer 2 (Integration)** | 20% coverage | 40% coverage | Recommended |
| **Layer 3 (Component)** | Critical paths only | — | Optional |
| **Layer 4 (E2E)** | Smoke tests | Critical paths | Recommended |
| **Code review** | 1 approval | — | Required |
| **Security scan** | No critical CVEs | — | Blocks release |
| **Performance** | — | — | Not monitored |

**Quality gates**:
- PR requires passing tests (if tests exist)
- No coverage drop enforcement
- E2E tests recommended but not blocking
- Must meet GA requirements before promotion to GA

**Decision (Q1)**: Coverage requirements are enforced only when promoting TP to GA. TP plugins are not blocked on coverage during their TP lifecycle, but must meet GA requirements before promotion. This avoids premature enforcement on experimental work.

**Current state** (verified 2026-07-24):
- 4/7 TP workspaces have E2E tests (57%)
- TP gaps: `cost-management` (smoke only), `pingidentity` (smoke only), `scaffolder-relation-processor` (no tests)

---

### Community — SANITY & LOAD CHECKS

| Requirement | Minimum | Target | Enforcement |
|-------------|---------|--------|-------------|
| **Layer 1 (Unit)** | — | Any coverage is good | Not required |
| **Layer 2 (Integration)** | — | — | Not required |
| **Layer 3 (Component)** | — | — | Not required |
| **Layer 4 (E2E)** | — | — | Not required |
| **Load test** | Plugin loads without error | — | Required |
| **Config validation** | appConfigExamples are valid | — | Required |
| **Security scan** | No critical CVEs in dependencies | — | Warning only |
| **Code review** | — | — | Not required |

**Quality gates**:
- Plugin must load in default RHDH instance
- Configuration examples must not crash the app
- No blocking requirements on test coverage

**Decision (Q2)**: All Community plugins must pass a load test (plugin loads without error in a default RHDH instance). This is already partially implemented: 22/40 community workspaces have smoke tests in the overlay repo.

**Current state** (verified 2026-07-24):
- 9/40 Community workspaces have E2E tests (23%)
- 22/40 Community workspaces have smoke tests (55%)
- 14/40 Community workspaces have neither E2E nor smoke tests

---

### Dev Preview — EXPERIMENTAL (NO REQUIREMENTS)

| Requirement | Minimum | Target | Enforcement |
|-------------|---------|--------|-------------|
| **All test layers** | — | — | Not required |
| **Load test** | — | — | Not required |
| **Code review** | — | — | Not required |
| **Security scan** | — | — | Not required |

**Quality gates**: None. Experimental quality, may break.

**Current state** (verified 2026-07-24):
- 3/6 Dev-Preview workspaces have E2E tests (50%)
- 3/6 have smoke tests

---

## Implementation Phases

### Phase 1: Baseline & Documentation (Current)

**Goal**: Document current state and establish requirements.

**Tasks**:
1. Define testing matrix (this document)
2. GA plugin E2E coverage gap analysis (completed 2026-07-24: 3 gaps identified)
3. Enhance sanity checks for all enabled plugins
4. Validate plugin appConfigExamples against schemas (overlay repo)

---

### Phase 2: Enforcement for GA

**Goal**: Enforce Layer 1-2 coverage requirements for GA plugins.

**Tasks**:
1. Add Codecov coverage gates for GA plugins
2. Create E2E tests for remaining 3 GA plugins without E2E (upstream-owned)
3. Configure branch protection to require tests

**Depends on**: RHIDP-13233 (Add Layer 1-2 tests for RHDH-owned plugins)

---

### Phase 3: Community Plugin Quality

**Goal**: Implement load/sanity checks for Community plugins.

**Tasks**:
1. Implement Community plugin load-test suite
2. Add appConfigExamples schema validation
3. Define quality expectations for community plugins

---

## Exception Process

### When Can Requirements Be Waived?

**GA plugins**:
- **Technical blocker**: External dependency prevents testing — document in Jira
- **Timeline**: Release deadline conflict — requires PM approval + technical debt ticket
- **Coverage drop**: Legacy code deletion lowers % — allowed if absolute coverage increases

**Tech Preview plugins**:
- **Promotion path**: TP to GA requires meeting GA requirements first
- **Exception**: Can ship with lower coverage if documented

**Community plugins**: No exceptions needed (already minimal requirements).

### Approval Process

1. Engineer files exception request in Jira
2. Tech lead reviews technical justification
3. PM approves timeline/priority trade-off
4. Exception logged with expiry date
5. Follow-up ticket created for remediation

---

## Quality Metrics Dashboard

### What We Track

**Per support level**:
- Test coverage % (Layer 1, 2, 3 combined)
- E2E test coverage (% of workspaces with E2E)
- Test execution time
- Flaky test rate
- CVE count by severity

**Current baselines** (measured 2026-07-24):

| Level | E2E Coverage | Smoke Coverage | Unit Tests (rhdh-plugins) |
|-------|-------------|----------------|---------------------------|
| **GA** | 14/17 (82%) | 9/17 (53%) | 5/5 RHDH-owned workspaces |
| **TP** | 4/7 (57%) | 4/7 (57%) | 3 workspaces |
| **Community** | 9/40 (23%) | 22/40 (55%) | 3 workspaces |
| **Dev-Preview** | 3/6 (50%) | 3/6 (50%) | 5 workspaces |

**Dashboard**: [Codecov rhdh-plugins](https://app.codecov.io/gh/redhat-developer/rhdh-plugins)  
**Components configured**: GA Plugins, Tech-Preview Plugins, Community Plugins, Dev-Preview Plugins

---

## Frontend vs Backend Testing (Q3)

**Decision**: Same requirements for frontend and backend initially. Reassess after Phase 1 data collection shows whether differentiation is needed.

**Rationale**: Applying uniform requirements simplifies communication and enforcement. If data reveals that frontend plugins consistently achieve coverage through Layer 3 component tests while backend plugins rely on Layer 2 integration tests, we can refine the matrix.

---

## Recent Progress (as of 2026-07-24)

### Coverage Infrastructure (delivered)
- Codecov configured across all 3 repos (rhdh, rhdh-plugins, overlays)
- Per-workspace flags with support-level component grouping (rhdh-plugins)
- E2E coverage collection via V8/Playwright (rhdh PR #4798)
- Coverage snapshots for 5 workspaces in overlay repo
- All coverage checks set to `informational` (never blocks PRs)

### Test Layers (delivered)
- Layer 1+2 backend tests: rhdh PR #4863
- Layer 3 component tests: rhdh PR #4864
- Layer 1-3 writing guide: rhdh PR #5140 (docs/testing.md)
- Cluster-free E2E harness (L4a): rhdh PR #5005, expanded in #5057 (14 test cases)
- Native smoke harness (no Docker): overlays PR #2714, #2731

### Active Test Expansion
- Orchestrator: 6 test PRs merged in July 2026 (RHIDP-15513) — 105 test files
- Plugin sanity cluster-free check: rhdh PR #4967 (open)
- Overlay E2E improvements: quay (#2873), argocd/topology (#2864), tekton (#2804)

### Decision Records
- Vitest migration: DEFER — stay with Jest (docs/decisions/vitest-migration-spike.md)
- Per-support-level Codecov: ENHANCE existing (docs/decisions/codecov-per-support-level-analysis.md)

---

## Related Work

### Completed

- **RHIDP-13511**: Per-support-level coverage reporting to Codecov
- **RHIDP-13503**: Align PR coverage upload with baseline workflow
- **RHIDP-13504**: Vitest migration spike (recommendation: stay with Jest)
- **RHIDP-13233**: Layer 1-2 tests for RHDH-owned backend plugins
- **RHIDP-13235**: Layer 3 component tests mirroring UI E2E specs

### In Progress

- **RHIDP-15513**: Orchestrator test coverage expansion
- **RHIDP-13508**: Cluster-free plugin sanity check

### Blocked

- **RHIDP-13505**: Enforce PR gating on test failure (blocked by broader team alignment)

---

## References

- **Epic**: RHIDP-13497 — Plugin Testing by Support Level
- **Parent strategy**: [RHDH .Next() Test Strategy](https://docs.google.com/document/d/1B-Jl1uwX3sdWOGqs9CN9rTFYH743q-o5YVMoAz_yPh8) — this document covers the "Requirements for Plugin Owners" section
- **Feature**: RHDHPLAN-1258 — RHDH Test Strategy Adoption (2.1+)
- **E2E layer migration matrix**: [docs/e2e-tests/layer-migration-matrix.md](e2e-tests/layer-migration-matrix.md)
- **Codecov analysis**: [docs/decisions/codecov-per-support-level-analysis.md](decisions/codecov-per-support-level-analysis.md)
- **Vitest spike**: [docs/decisions/vitest-migration-spike.md](decisions/vitest-migration-spike.md)
- **Test writing guide**: [docs/testing.md](testing.md)
- **Codecov dashboards**:
  - [rhdh](https://app.codecov.io/gh/redhat-developer/rhdh)
  - [rhdh-plugins](https://app.codecov.io/gh/redhat-developer/rhdh-plugins)
  - [rhdh-plugin-export-overlays](https://app.codecov.io/gh/redhat-developer/rhdh-plugin-export-overlays)

---

## Changelog

- **2026-06-17**: Initial draft based on research and industry best practices
- **2026-07-24**: Updated with verified E2E coverage data, resolved open questions, added governance and recent progress sections
