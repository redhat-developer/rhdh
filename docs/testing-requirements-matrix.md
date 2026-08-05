# RHDH Plugin Quality Requirements by Support Level

**Epic**: RHIDP-13497 — Plugin Testing by Support Level  
**Author**: Gustavo Lira e Silva  
**Date**: 2026-06-17 (updated 2026-08-04)  
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
| **Tech Preview (TP)** | Beta quality, not production-ready | Limited support, no SLA | 8 |
| **Community** | Community-maintained | No Red Hat support | 41 |
| **Dev Preview** | Experimental, under active development | No support, may change | 5 |

**Total**: 64 distinct workspaces across 4 support levels (some workspaces contain packages at multiple support levels, so the column above sums higher).

**Source of truth**: Support levels are defined in `rhdh-plugin-export-overlays/workspaces/*/metadata/*.yaml` (`spec.support` field).

## Test Layer Definitions

| Layer | Type | Scope | Tools | Execution Time |
|-------|------|-------|-------|----------------|
| **Layer 1** | Unit Tests | Individual functions, pure logic | Jest, supertest, `mockServices` | Seconds |
| **Layer 2** | Integration Tests | Plugin wiring, DB, service-to-service | Jest + `startTestBackend` | Seconds to minutes |
| **Layer 3** | Component Tests | React components, user interactions | RTL, `@backstage/frontend-test-utils`, jsdom | Minutes |
| **Layer 4a** | Plugin E2E | Real browser against a local Backstage instance — no cluster | Playwright (local `webServer`) | Minutes |
| **Layer 4b** | Platform E2E | Full system on a deployed instance | Playwright, K8s/OCP | Minutes to hours |

`startTestBackend` belongs to Layer 2, not Layer 3 — it starts a real Backstage backend
in-process with in-memory SQLite. Layer 3 renders React with a mocked Backstage context and
never starts a backend.

Layer 4 is split because not every browser test needs a cluster. Where the requirement tables
below say "E2E", **Layer 4a is the default**; Layer 4b applies only when the test genuinely
requires real infrastructure (OAuth providers, Kubernetes API, external databases, operators),
and that rationale must be documented on the test.

Jest is the test runner for Layers 1-3. A Vitest migration was evaluated and deferred under
RHIDP-13504, pending Backstage upstream completing its own migration.

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

**Threshold precedence**: the percentages above are per support level, measured through
Codecov `components`/`flags`. They are independent of the repository-wide floors defined in
Section 5 of the Test Strategy Proposal. Where the two differ, the support-level value applies.

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

**Current state** (verified 2026-08-04):
- 5/8 TP workspaces have E2E tests (63%)
- 4/8 have smoke tests
- TP gaps: `cost-management` (smoke only), `pingidentity` (smoke only), `scaffolder-relation-processor` (no tests)

---

### Community — SANITY & LOAD CHECKS

| Requirement | Minimum | Target | Enforcement |
|-------------|---------|--------|-------------|
| **Layer 1 (Unit)** | — | Any coverage is good | Not required |
| **Layer 2 (Integration)** | — | — | Not required |
| **Layer 3 (Component)** | — | — | Not required |
| **Layer 4 (E2E)** | — | — | Not required |
| **Load test** | Published artifact installs and boots | — | Required |
| **Config validation** | appConfigExamples are valid | — | Required |
| **Security scan** | No critical CVEs in dependencies | — | Warning only |
| **Code review** | — | — | Not required |

**Quality gates**:
- The published artifact must install and boot
- Configuration examples must not crash the app
- No blocking requirements on test coverage

**Decision (Q2)**: All Community plugins must pass a load test. This is already partially implemented: 22/41 community workspaces have smoke tests in the overlay repo.

> **Wording note (2026-08-04)**: this requirement previously read "plugin loads without error in a
> default RHDH instance". That phrasing no longer maps to this tier — community plugins were
> removed from `default.packages.yaml` under RHIDP-13262 (2.1.0) to enable multi-arch builds, so
> there is no default RHDH instance containing them. They exist only as artifacts published by
> `rhdh-plugin-export-overlays` to ghcr. The operative definition is now **"the published artifact
> installs and boots"**, verified off-cluster and without Docker by the overlays
> `smoke-tests-native/` harness.

**Current state** (verified 2026-08-04):
- 10/41 Community workspaces have E2E tests (24%)
- 22/41 Community workspaces have smoke tests (54%)
- 15/41 Community workspaces have neither E2E nor smoke tests

Against the 2026-07-24 snapshot (40 workspaces / 22 smoke / 9 E2E / 14 neither) coverage is
**static**: one workspace was added and arrived uncovered, one existing workspace gained E2E.
Hand-written per-workspace coverage does not close this gap on its own, which is the rationale
for the metadata-driven sweep tracked in RHIDP-13510.

**Scope of the load test** (RHIDP-13510): all 107 community packages get OCI install validation;
49 of 53 backend packages get a real boot via `startTestBackend`; 4 catalog-extending backend
modules are install-only (the catalog core does not boot standalone) and stay on the Docker smoke;
the 54 frontend packages get bundle-layout validation only. Frontend **rendering** is deferred to
RHIDP-16009, blocked on the new frontend system (RHIDP-15082 / RHIDP-15379).

---

### Dev Preview — EXPERIMENTAL (NO REQUIREMENTS)

| Requirement | Minimum | Target | Enforcement |
|-------------|---------|--------|-------------|
| **All test layers** | — | — | Not required |
| **Load test** | — | — | Not required |
| **Code review** | — | — | Not required |
| **Security scan** | — | — | Not required |

**Quality gates**: None. Experimental quality, may break.

**Current state** (verified 2026-08-04):
- 2/5 Dev-Preview workspaces have E2E tests (40%)
- 3/5 have smoke tests

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
1. Implement Community plugin load-test suite — RHIDP-13510, open. Metadata-driven sweep over
   every `spec.support: community` package, run through the overlays `smoke-tests-native/`
   harness (no cluster, no Docker). Frontend rendering split out to RHIDP-16009.
2. Add appConfigExamples schema validation — done (RHIDP-13509, RHIDP-15902, RHIDP-15903)
3. Define quality expectations for community plugins — done (RHIDP-13512)

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

## Compliance Verification (proposal — not yet agreed)

> **Status**: this section is a proposal from Quality Engineering. It is not agreed policy and
> creates no obligation for any plugin owner today. Adopting it requires sign-off through the
> RHDH Plugin Ecosystem RACI — in particular from Productization, Security and Product
> Management, and explicitly so for 3rd-party plugins, whose owners are outside RHDH
> Engineering and cannot be bound by a decision taken in this repository alone.

Requirements without a named verifier become self-attestation. The table below proposes who
would check what, against which artifact, and at which milestone, as a starting point for that
discussion.

| Milestone | What would be verified | Artifact | Proposed verifier | Proposed outcome if it fails |
|-----------|------------------------|----------|-------------------|------------------------------|
| PR merge | Layer 1-2 pass; coverage delta | Codecov PR check | Automated (`codecov.yml`) | PR blocked (GA only) |
| Feature freeze | Support-level thresholds met | Codecov component report per workspace | Quality | Plugin ships at the next lower support level |
| TP to GA promotion | Full GA row of this matrix | Compliance report (below) | Quality | Promotion deferred pending remediation |
| Every release | Plugin loads in a default RHDH instance | Overlay load-test / smoke result | Quality | Escalated to the plugin owner before release |

**Compliance report**: would be generated per release from Codecov component data plus the
overlay load-test results, and shared with plugin owners at feature freeze so gaps are visible
early rather than at release time.

**Open questions for the RACI discussion**:

- Should verification outcomes be advisory or blocking, and blocking at which milestone?
- What evidence is acceptable from 3rd-party plugin owners who do not build on RHDH CI?
- Who arbitrates a disputed result — Quality, Product Management, or the release lead?

These are deliberately left open. Answering them is the point of the discussion, not a
precondition for it.

---

## Quality Metrics Dashboard

### What We Track

**Per support level**:
- Test coverage % (Layer 1, 2, 3 combined)
- E2E test coverage (% of workspaces with E2E)
- Test execution time
- Flaky test rate
- CVE count by severity

**Current baselines** (measured 2026-08-04):

| Level | E2E Coverage | Smoke Coverage | Unit Tests (rhdh-plugins) |
|-------|-------------|----------------|---------------------------|
| **GA** | 14/17 (82%) | 9/17 (53%) | 5/5 RHDH-owned workspaces |
| **TP** | 5/8 (63%) | 4/8 (50%) | 3 workspaces |
| **Community** | 10/41 (24%) | 22/41 (54%) | 3 workspaces |
| **Dev-Preview** | 2/5 (40%) | 3/5 (60%) | 5 workspaces |

Across the overlays repo as a whole: 24 of 64 workspaces have `e2e-tests/` and 33 have
`smoke-tests/`. Unit-test columns were not re-measured on 2026-08-04 and carry the
2026-07-24 values.

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
- Plugin sanity cluster-free check: rhdh PR #4967 (merged 2026-08-04) — sweeps the
  29-package catalog index (`quay.io/rhdh/plugin-catalog-index`), all GA
- Overlay E2E improvements: quay (#2873), argocd/topology (#2864), tekton (#2804)

### Decision Records
- Vitest migration: DEFER — stay with Jest (RHIDP-13504)
- Per-support-level Codecov: ENHANCE existing (RHIDP-13511)

---

## Related Work

### Completed

- **RHIDP-13511**: Per-support-level coverage reporting to Codecov
- **RHIDP-13503**: Align PR coverage upload with baseline workflow
- **RHIDP-13504**: Vitest migration spike (recommendation: stay with Jest)
- **RHIDP-13233**: Layer 1-2 tests for RHDH-owned backend plugins
- **RHIDP-13235**: Layer 3 component tests mirroring UI E2E specs
- **RHIDP-13508**: Cluster-free plugin sanity check for the catalog index (rhdh PR #4967)
- **RHIDP-13512**: Quality expectations for community-supported plugins

### In Progress

- **RHIDP-15513**: Orchestrator test coverage expansion
- **RHIDP-13510**: Community plugin load-test suite — the last open story in RHIDP-13497, and
  the only `Required` item in this matrix that is still unimplemented. Work lands in
  `rhdh-plugin-export-overlays` (`smoke-tests-native/`), not in this repo.

### Deferred

- **RHIDP-16009**: Community frontend plugin rendering — blocked on the new frontend system
  (RHIDP-15082, gated by RHIDP-15379)

### Blocked

- **RHIDP-13505**: Enforce PR gating on test failure (blocked by broader team alignment)

---

## References

- **Epic**: RHIDP-13497 — Plugin Testing by Support Level
- **Parent strategy**: [RHDH Test Strategy Proposal](https://docs.google.com/document/d/1n7jUaOzFLAGANmsyVrOOnFcwI65dAFESHXTsxY2DXhU) — that document defines the test layers; this one defines how much of each layer applies per support level
- **Feature**: RHDHPLAN-1258 — RHDH Test Strategy Adoption (2.1+)
- **E2E layer migration matrix**: [docs/e2e-tests/layer-migration-matrix.md](e2e-tests/layer-migration-matrix.md)
- **Test writing guide**: [docs/testing.md](testing.md)
- **Codecov dashboards**:
  - [rhdh](https://app.codecov.io/gh/redhat-developer/rhdh)
  - [rhdh-plugins](https://app.codecov.io/gh/redhat-developer/rhdh-plugins)
  - [rhdh-plugin-export-overlays](https://app.codecov.io/gh/redhat-developer/rhdh-plugin-export-overlays)

---

## Changelog

- **2026-06-17**: Initial draft based on research and industry best practices
- **2026-07-24**: Updated with verified E2E coverage data, resolved open questions, added governance and recent progress sections
- **2026-08-04**: Refreshed all support-level counts and coverage baselines against both repos' `main`; reworded the Community load-test requirement from "loads in a default RHDH instance" to "the published artifact installs and boots" (community plugins are no longer in the RHDH image — RHIDP-13262); recorded the RHIDP-13510 scope and its frontend-rendering split into RHIDP-16009
- **2026-07-27**: Aligned layer definitions with the Test Strategy Proposal (`startTestBackend` moved from Layer 3 to Layer 2; Layer 4 split into 4a/4b); Jest confirmed as the Layer 1-3 runner per the Vitest spike; added threshold precedence and a proposed Compliance Verification section (pending RACI sign-off)
