# Agents

## Agent skills

### Issue tracker

Issues live in Jira (RHIDP), not GitHub; fullsend drives agentic execution on GitHub PRs. Read `docs/agents/issue-tracker.md` before creating, searching, or updating issues.

### Triage labels

Triage applies the five-role label vocabulary in `docs/agents/triage-labels.md` as Jira labels.

### Domain docs

Domain vocabulary lives in `GLOSSARY.md`; decisions in `docs/adr/`. Read `docs/agents/domain.md` before exploring the codebase.

### Repo knowledge

`CONTEXT.md` holds high-level orientation and an index into `docs/agents/knowledge/` (detailed topics). Skills live in `.agents/skills/`.

### Agent-facing material

All agent-facing material lives in four places: this file (pointers), `CONTEXT.md` (orientation), `docs/agents/` (config and knowledge), `.agents/skills/` (skills). Bring a new harness in by pointing it at these files. New detailed knowledge goes in its own file under `docs/agents/knowledge/`, indexed from `CONTEXT.md`.
