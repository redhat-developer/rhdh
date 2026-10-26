# Distribute dynamic plugins from an OCI catalog index (ref://), not in-repo wrappers

From its 2023 origins until 2026, RHDH built thin wrapper packages inside
`dynamic-plugins/` and installed them into `dynamic-plugins-root/` via yarn.
RHDH now resolves plugins by `ref://` catalog references at deploy time: the
init container (`install-dynamic-plugins.py`) resolves them against a pinned
OCI catalog-index image (`quay.io/rhdh/plugin-catalog-index`), and the
`dynamic-plugins/` directory and all its build infrastructure, CI steps and
scripts were deleted from this repo.

Drivers (RHIDP-10847, RHIDP-13226): reach the "no wrappers" state targeted for
1.9/1.10; make RHDH repo Backstage upgrades (1.45.z onboarding) cheaper without
rebuilding dozens of wrappers; unlock plugin owners downstream (rhdh-plugins,
BCP) to track 1.45 sooner; accelerate Konflux builds. Decoupling plugin
versions from RHDH image releases moved the plugin supply chain to OCI
artifacts with `pullPolicy` semantics.

Consequences: the repo no longer contains the plugins it ships — plugin
versions are pinned in `dynamic-plugins.default.yaml`, generated from the
catalog index. Wrapper-era docs or muscle memory about `dynamic-plugins/` are
stale by design.

Evidence: PR #3737 (2025-12, `a18bbc98`), PR #5282 (2026-08, `0a4c4a72`,
RHIDP-13226), PR #5299 (2026-08, `d814f4b0` — wrapper deletion);
RHIDP-10847, RHIDP-13226.
