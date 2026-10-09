# Rulesync - AI Assistant Rules Management

This directory contains the source of truth for AI assistant rules, commands, and skills. `rulesync.jsonc` currently configures Cursor, Claude Code, and OpenCode.

## 📁 Directory Structure

```
.rulesync/
├── rules/           # Rule files (context-aware documentation)
├── commands/        # Command files (custom agent commands)
├── skills/          # One folder per skill, each with SKILL.md
└── README.md        # This file
```

## 🔄 Synchronization

### When you edit `.rulesync` files (Automatic):

```bash
# Just stage and commit - lint-staged handles the rest!
git add .rulesync/rules/my-rule.md
git commit -m "docs: update AI assistant rules"
# ✨ lint-staged automatically runs rulesync:generate and stages generated outputs
```

**What happens:**
1. You stage `.rulesync` files
2. Pre-commit hook runs `lint-staged`
3. `lint-staged` detects `.rulesync` changes and runs `yarn rulesync:generate`
4. Generated files in `.cursor`, `.claude`, `.opencode`, and `opencode.jsonc` are automatically staged
5. Commit includes both source and generated files

### When you edit `.cursor`, `.claude`, `.opencode`, or `opencode.jsonc` directly (Import before committing):

> ⚠️ **Note:** Prefer editing `.rulesync` files as the source of truth for easier management

```bash
# Import from the tool whose generated files you changed
yarn rulesync:import:cursor
# Or: yarn rulesync:import:claude
# Or: yarn rulesync:import:opencode

# Review the imported source, regenerate, and validate
git diff -- .rulesync
yarn rulesync:generate
yarn rulesync:check
git add .rulesync .cursor .claude .opencode opencode.jsonc
# Create a new commit containing the reviewed source and generated outputs
```

**What happens:**
1. You stage generated files without a matching source change
2. Pre-commit hook runs `lint-staged`
3. `lint-staged` **rejects the commit** and prints import instructions
4. You import and review the source changes, then regenerate and validate
5. You stage source and generated files together and retry the commit

## 📝 Available Commands

| Command | Description |
|---------|-------------|
| `yarn rulesync:generate` | Generate `.cursor`, `.claude`, and `.opencode` configs from `.rulesync` |
| `yarn rulesync:check` | Validate the Rulesync config and verify generated files are up to date |
| `yarn rulesync:import:cursor` | Import changes from `.cursor` only |
| `yarn rulesync:import:claude` | Import changes from `.claude` only |
| `yarn rulesync:import:opencode` | Import changes from `.opencode` only |

## 🤖 Continuous Integration

A GitHub Actions workflow validates synchronization on relevant PRs and pushes to main and release branches:

- **Workflow**: `.github/workflows/rulesync-check.yaml`
- **Triggers**: Changes to `.rulesync`, `.cursor`, `.claude`, `.opencode`, or config files
- **What it does**: Runs `yarn rulesync:check` (`doctor --strict` plus `generate --check`)
- **If it fails**: Run the appropriate command based on what you edited:
  - `yarn rulesync:generate` if you forgot to generate files from `.rulesync`
  - `yarn rulesync:import:cursor` if you edited `.cursor` files directly
  - `yarn rulesync:import:claude` if you edited `.claude` files directly
  - `yarn rulesync:import:opencode` if you edited `.opencode` files directly
  - Then commit the changes

Generation uses the targets and features in `rulesync.jsonc`, including skill
outputs. With `delete: true`, removing a source file also removes its managed
outputs on the next generation.

## 🎯 Best Practices

1. **Edit `.rulesync` files as the source of truth**
   - Changes here propagate to all AI assistants
   - Easier to maintain consistency
   - **lint-staged automatically generates configs on commit!**

2. **Let automation handle the sync for `.rulesync`**
   - Just stage `.rulesync` files and commit
   - Generated files are automatically included
   - No manual `yarn rulesync:generate` needed!

3. **Import `.cursor`/`.claude`/`.opencode` edits before committing**
   - Generated-only edits are rejected by the hook
   - Run the matching import command and review its source changes
   - Regenerate all configured targets and run `yarn rulesync:check`

4. **Use `.local.md` for personal rules**
   - Files matching `*.local.md` are ignored by git
   - Perfect for personal preferences or sensitive info

## 📚 Rule File Format

Each rule file should have YAML frontmatter:

```yaml
---
targets: ["*"]              # Which AI assistants to target
root: false                 # Always apply (true) or context-aware (false)
description: "Rule purpose"
globs:                      # When to apply this rule
  - "path/to/files/**"
cursor:                     # Cursor-specific settings
  alwaysApply: false
  globs:
    - "path/to/files/**"
---

# Rule Content

Your rule documentation here...
```

## 🔗 More Information

- [Rulesync GitHub](https://github.com/dyoshikawa/rulesync)
- [Configuration](../rulesync.jsonc)
