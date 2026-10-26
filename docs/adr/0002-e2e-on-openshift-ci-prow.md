# Run E2E against real clusters on OpenShift CI (Prow) with ephemeral cluster claims

RHDH's E2E suite (Playwright, `e2e-tests/`) always deploys a real RHDH instance —
via both the Helm chart and the Operator — onto ephemeral clusters claimed from
Hive pools, running a multi-platform matrix (OCP, EKS, GKE, AKS) under Prow-based
OpenShift CI. Mocked or preview-mode E2E was rejected because the supported
product is a deployment (chart + operator + dynamic plugins + config), not just
a web app, and deployment fidelity is what the suite exists to protect.

The move off IBM Cloud managed pipelines (PR #1170, 2024-04) was driven by
operational limits of the old setup: PR re-testing required no-op commits,
and test artifacts (videos, screenshots, HTML logs) had no first-class home.
OpenShift CI was chosen over a Tekton pipeline of our own for the `/test`
re-trigger mechanism and job artifact storage (RHIDP-1687). Job definitions
live in the external `openshift/release` repo — a constraint, not a choice
made here.

Evidence: PR #857 (2024-01, `ea85646a`), PR #1170 (2024-04, `1557159e`),
PR #2145 (2025-01, `a0dff4b`), PR #2242 (2025-01, `f200e8c`);
`.ci/pipelines/`, RHIDP-1687.
