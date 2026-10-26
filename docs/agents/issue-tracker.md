# Issue Tracker

Jira is the source of truth for all work in this repo (Red Hat Developer Hub).
Issues do **not** live in GitHub Issues. Fullsend
(https://github.com/fullsend-ai/fullsend) drives the agentic SDLC — its agents
triage, implement, review, and merge GitHub pull requests — but planning and
tracking happen in Jira.

## Where issues live

- **RHIDP** — engineering work (Epics, Stories, Tasks, Spikes)
- **RHDHPLAN** — feature requests
- **RHDHBUGS** — customer bugs
- **RHDHSUPP** — support conversations

## Working with issues

- Create: `rhdh-jira-create` skill (`acli`-based)
- Read/search: `rhdh-jira-api` skill (JQL, custom fields, boards)
- Update: `rhdh-jira-update` skill (comments, transitions, links, assignment)

## PRs

GitHub PRs link back to their Jira issue via web links (`rhdh-jira-link`).
Fullsend may execute the code side autonomously; the Jira issue remains the
planning and status record.
