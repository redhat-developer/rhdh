# Ship plugins as dynamic plugins, not statically bundled code

RHDH delivers plugin functionality as dynamic plugins loaded at runtime by
Backstage's backend plugin manager from `dynamic-plugins-root/`, so supported
plugins can be enabled or disabled per deployment with only a restart — no
rebuild of the RHDH image. Statically bundling every supported plugin into
`packages/backend` was rejected because RHDH is a supported distribution and
customers must be able to tailor the plugin set of their own instances.

Status: accepted; packaging evolved in ADR-0004 — the runtime model is
unchanged, plugins now arrive from an OCI catalog index instead of in-repo
wrappers.

Consequences: every supported plugin must be packaged as a derived dynamic
plugin (never published to public npm); frontend plugins require scalprum-based
wiring (mount points, dynamic routes); the backend app wires
dynamic-plugin-aware modules rather than static plugin imports.

Evidence: PR #522 (2023-10, `5e450082`), PR #599 (2023-10, `4af2b852`);
`docs/dynamic-plugins/index.md`.
