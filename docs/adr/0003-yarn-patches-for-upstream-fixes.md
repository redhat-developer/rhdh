# Carry downstream fixes as yarn patches on released upstream packages

When RHDH needs a change in an upstream Backstage package before (or instead of)
an upstream release, the fix is developed as if for an upstream PR, then carried
in this repo as a patch file under `.yarn/patches/` applied to the released npm
package via `resolutions` — never as a vendored fork of upstream code. This keeps
the repo diff-to-upstream minimal and upgrade-driven
(`scripts/update-backstage.mjs`) at the cost of regenerating patches on every
relevant upstream version bump.

Considered options: vendoring/forking upstream packages (rejected — makes
Backstage version upgrades a merge problem instead of a lockfile bump), and
waiting for upstream releases (rejected — blocks customer fixes on upstream
release timing).

Evidence: PR #1262 (2024-05, `1c88c8a2`); `docs/patch-package.md` (mechanics);
active example: `@backstage/core-components` patch pinned in root `package.json`
`resolutions`.
