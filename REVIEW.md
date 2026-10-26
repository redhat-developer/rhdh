# Review Guide

Tells the reviewer what matters in this repo. Read `AGENTS.md` first; load the
knowledge doc for each area the diff touches (index in `CONTEXT.md`).

## What failure looks like here

- **E2E tests that lie**: pass locally, fail in the Prow multi-platform matrix
  (`docs/agents/knowledge/e2e-testing.md`). A test that needs a hand-tuned
  local cluster is a bug.
- **CI workflows that leak**: unpinned actions, `pull_request_target` with PR
  checkout, secrets through `GITHUB_ENV`
  (`docs/agents/knowledge/github-workflows-security.md`).
- **Upstream drift**: `.yarn/patches` or `resolutions` changes that bypass the
  `patch-backstage` workflow.
- **Plugin versions off the index**: plugin-set changes belong in
  `dynamic-plugins.default.yaml` (generated from the OCI catalog index —
  ADR-0004); a PR adding wrapper packages or build steps for plugins reverts
  a recorded decision.
- **Config that misroutes**: `app-config` changes hardcoding values that belong
  in `${ENV_VAR}` placeholders.
- **Docs that lie**: README or knowledge-doc lines the diff makes stale — flag
  them, don't paraphrase around them.

## Evidence and output

- Every finding cites a file and line from the diff; a guess from a name is
  not a finding.
- Summary starts with a count: "N findings: X important, Y nit, Z
  pre-existing." When nothing needs fixing, say so plainly.
- Tag each finding Important / Nit / Pre-existing.
- Flag the class of bug with every occurrence, so the author fixes the
  pattern, not one line.

## Nits

- Style and formatting belong to lint — post none.
- Cap: three nits per review, each tied to a future bug it prevents.

## Paths to skip

Generated output only: `dynamic-plugins-root/` contents, `.yarn/`,
`packages/*/dist*`, `**/dist/`, `coverage/`, `e2e-tests/**/test-results/`,
`playwright-report/`, `.playwright-mcp/`, `yarn.lock`

## Convergence

- Round cap: after three rounds, ask the author to reconsider the approach.
- After the first pass, re-review only the new diff; never repost a finding.
- Every finding gets answered: fixed, or resolved with a reason.

## Always needs a human

CI workflow files, auth, `release-*` patch changes, dynamic plugin schema
changes. Flag changes that contradict an ADR in `docs/adr/`.
