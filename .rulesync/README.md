# Rulesync - AI Assistant Rules Management

This directory contains the source of truth for AI assistant rules (Cursor, Claude Code, Copilot, etc.).

## 📁 Directory Structure

```
.rulesync/
├── rules/           # Rule files (context-aware documentation)
├── commands/        # Command files (custom agent commands)
└── README.md        # This file
```

## 🔄 Synchronization

### When you edit `.rulesync` files (Automatic):

```bash
# Just stage and commit - lint-staged handles the rest!
git add .rulesync/rules/my-rule.md
git commit -m "docs: update AI assistant rules"
# ✨ lint-staged automatically runs rulesync:generate and stages .cursor/.claude
```

**What happens:**
1. You stage `.rulesync` files
2. Pre-commit hook runs `lint-staged`
3. `lint-staged` detects `.rulesync` changes and runs `yarn rulesync:generate`
4. Generated files in `.cursor` and `.claude` are automatically staged
5. Commit includes both source and generated files

### When you edit `.cursor` or `.claude` files directly (Manual with notification):

> ⚠️ **Note:** Prefer editing `.rulesync` files as the source of truth for easier management

```bash
# Stage your changes
git add .cursor/rules/my-rule.mdc
git commit -m "docs: update rule"

# ⚠️  You'll see a notification:
# "Direct changes to .cursor detected!"
# "To sync back to .rulesync, run:"
#    yarn rulesync:import:cursor
#    git add .rulesync

# Follow the instructions to sync back
yarn rulesync:import:cursor
git add .rulesync
git commit --amend --no-edit  # Add to the same commit
```

**What happens:**
1. You stage `.cursor` or `.claude` files
2. Pre-commit hook runs `lint-staged`
3. `lint-staged` **displays a notification** with instructions
4. Commit proceeds (without automatic import)
5. You **manually** run the import command if you want to sync

## 📝 Available Commands

| Command | Description |
|---------|-------------|
| `yarn rulesync:generate` | Generate `.cursor` and `.claude` configs from `.rulesync` |
| `yarn rulesync:import:cursor` | Import changes from `.cursor` only |
| `yarn rulesync:import:claude` | Import changes from `.claude` only |

## 🤖 Continuous Integration

A GitHub Actions workflow automatically validates synchronization on all PRs and pushes to main:

- **Workflow**: `.github/workflows/rulesync-check.yaml`
- **Triggers**: Changes to `.rulesync`, `.cursor`, `.claude`, or config files
- **What it does**: Runs `yarn rulesync:generate` and checks for differences
- **If it fails**: Run the appropriate command based on what you edited:
  - `yarn rulesync:generate` if you forgot to generate files from `.rulesync`
  - `yarn rulesync:import:cursor` if you edited `.cursor` files directly
  - `yarn rulesync:import:claude` if you edited `.claude` files directly
  - Then commit the changes

## 🎯 Best Practices

1. **Edit `.rulesync` files as the source of truth**
   - Changes here propagate to all AI assistants
   - Easier to maintain consistency
   - **lint-staged automatically generates configs on commit!**

2. **Let automation handle the sync for `.rulesync`**
   - Just stage `.rulesync` files and commit
   - Generated files are automatically included
   - No manual `yarn rulesync:generate` needed!

3. **Manual sync for `.cursor`/`.claude` edits**
   - You'll get a notification on commit
   - Run the suggested import command
   - This gives you control over when to sync back

4. **Use `.local.md` for personal rules**
   - Files matching `*.local.md` are ignored by git
   - Perfect for personal preferences or sensitive info

## 📚 Rule File Format

Each rule file should have YAML frontmatter-:

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

