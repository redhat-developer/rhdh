---
description: Trigger RHDH nightly CI jobs on demand via the OpenShift CI Gangway REST API. Allows natural language selection of jobs and image tags.
---
# Trigger Nightly Job

This command delegates to the **prow-trigger-nightly** skill maintained in the [rhdh-skills](https://github.com/redhat-developer/rhdh-skills) repository.

## Agent Behavior

1. **Check if the skill is already installed.** Look for a skill named `prow-trigger-nightly` in the available skills list.
2. **If installed**, invoke it immediately with the user's request.
3. **If not installed**, read the [rhdh-skill repository](https://github.com/redhat-developer/rhdh-skill) to find installation instructions, guide the user through setup, then invoke the skill.
