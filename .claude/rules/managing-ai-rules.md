---
paths: '.rulesync/**, .cursor/**, .claude/**'
---
# Managing AI Assistant Rules

This document provides guidelines for creating, importing, and managing AI assistant rules, commands, and configurations.

## 📁 Directory Structure

```text
.rulesync/
├── rules/              # Rule files (.md files with frontmatter)
├── commands/           # Command files (.md files with frontmatter)
└── README.md          # Documentation
```

## 🤖 Automated Checks

A GitHub Actions workflow (`.github/workflows/rulesync-check.yaml`) automatically validates that generated files in `.cursor` and `.claude` are in sync with `.rulesync` on:
- All pull requests
- Pushes to main and release branches

**What it checks:**
- Runs `yarn rulesync:generate`
- Compares generated files with committed files
- Fails if there are differences

**If the check fails, run the appropriate command based on what you edited:**

```bash
# If you forgot to generate from .rulesync
yarn rulesync:generate
git add .cursor .claude

# If you edited .cursor files directly
yarn rulesync:import:cursor
git add .rulesync

# If you edited .claude files directly
yarn rulesync:import:claude
git add .rulesync

# Then commit and push
git commit --amend --no-edit
git push --force-with-lease
```

## ✨ Creating New Rules

### Step 1: Create the Rule File

Create a new markdown file in `.rulesync/rules/`:

```bash
# Example: Create a new rule for API development
touch .rulesync/rules/api-development.md
```

### Step 2: Add Frontmatter

Every rule file must have YAML frontmatter:

```yaml
---
targets:
  - '*'                    # Target all AI assistants
root: false                # Context-aware (not always loaded)
description: >-
  Brief description of what this rule covers
globs:                     # File patterns when this rule applies
  - src/api/**
  - tests/api/**
cursor:                    # Cursor-specific configuration
  alwaysApply: false
  description: >-
    Brief description of what this rule covers
  globs:
    - src/api/**
    - tests/api/**
claude:                    # Claude-specific configuration (optional)
  description: >-
    Brief description of what this rule covers
---
```

### Step 3: Write the Rule Content

After the frontmatter, write your rule in markdown:

```markdown
# API Development Guidelines

## Overview

This rule provides guidelines for developing APIs in this project.

## Best Practices

1. **Use TypeScript** - All API code must be in TypeScript
2. **Validate inputs** - Use zod schemas for validation
3. **Document endpoints** - Include JSDoc comments

## Examples

\`\`\`typescript
// Good example
export async function getUser(id: string): Promise<User> {
  // Implementation
}
\`\`\`
```

### Step 4: Generate Configurations

After creating or editing the rule:

```bash
# This happens automatically on commit, but you can run manually:
yarn rulesync:generate

# Then stage and commit
git add .rulesync/rules/api-development.md .cursor .claude
git commit -m "docs: add API development rule"
```

## 📥 Importing Existing Rules

### Scenario 1: Rules Already Exist in `.cursor`

If you have existing rules in `.cursor/rules/*.mdc`:

```bash
# 1. Import all rules from Cursor
yarn rulesync:import:cursor

# 2. Review the imported files in .rulesync

# 3. Edit if needed to match the proper format
```

### Scenario 2: Rules Already Exist in `.claude`

If you have existing rules in `.claude/memories/*.md`:

```bash
# 1. Import all rules from Claude
yarn rulesync:import:claude

# 2. Review the imported files in .rulesync

# 3. Edit if needed to match the proper format
```

## 🎯 Creating Commands

Commands are similar to rules but define specific agent commands.

### Step 1: Create Command File

```bash
touch .rulesync/commands/analyze-code.md
```

### Step 2: Add Frontmatter and Content

```markdown
---
description: Analyze code quality and provide suggestions
targets: ["*"]
---

# Analyze Code Command

Execute the following steps:

1. Read the target files
2. Check for:
   - Code smells
   - Security issues
   - Performance problems
3. Provide actionable suggestions
```

## 📋 Frontmatter Field Reference

### Required Fields

- **`targets`** - Array of AI assistants to target
  - `["*"]` - All assistants
  - `["cursor"]` - Cursor only
  - `["claudecode"]` - Claude Code only
  - `["cursor", "copilot"]` - Multiple specific assistants

- **`description`** - Brief description of the rule/command

### Optional Fields

- **`root`** - Boolean, whether to always load this rule
  - `true` - Always loaded (root-level rule)
  - `false` - Context-aware (loaded based on globs)

- **`globs`** - Array of file patterns when to apply this rule
  ```yaml
  globs:
    - "src/**/*.ts"
    - "tests/**/*.spec.ts"
  ```

- **`cursor`** - Cursor-specific configuration
  ```yaml
  cursor:
    alwaysApply: false
    description: "Rule description"
    globs:
      - "path/**"
  ```

- **`claude`** - Claude-specific configuration
  ```yaml
  claude:
    description: "Rule description"
  ```

## 🚫 What NOT to Do

### ❌ Don't Edit Generated Files in `.cursor` and `.claude` Directly

Instead, edit the source in `.rulesync/` and then regenerate them:

```bash
yarn rulesync:generate  # Regenerate (or commit to auto-generate)
```

### ❌ Don't Forget Frontmatter

Every rule must have proper frontmatter. Without it, rulesync cannot process the file.

### ❌ Don't Use Absolute Paths in Globs

```yaml
# BAD
globs:
  - /Users/username/project/src/**

# GOOD - Use relative paths
globs:
  - src/**
```

## 🔄 Synchronization Workflow

### Normal Workflow (Recommended)

```bash
# 1. Edit source files
vim .rulesync/rules/my-rule.md

# 2. Stage and commit
git add .rulesync/rules/my-rule.md
git commit -m "docs: update my-rule"
# ✨ Auto-generates .cursor/.claude on commit
```

### If You Edited .cursor or .claude Directly

```bash
# 1. Commit your changes (you'll see a notification)
git add .cursor/rules/my-rule.mdc
git commit -m "docs: update rule"

# 2. You'll see:
# ⚠️  Direct changes to .cursor detected!
# 💡 To sync back to .rulesync, run:
#    yarn rulesync:import:cursor
#    git add .rulesync

# 3. Follow the instructions
yarn rulesync:import:cursor
git add .rulesync
git commit --amend --no-edit
```

## 📝 Use `.local.md` for Personal Rules

For personal or machine-specific rules that shouldn't be committed:

```bash
# Create a local rule
vim .rulesync/rules/my-personal-setup.local.md

# This will be ignored by git
git status  # Won't show the .local.md file
```

Local files:
- ✅ `.rulesync/rules/*.local.md` - Ignored
- ✅ `.cursor/rules/*.local.mdc` - Ignored
- ✅ `.claude/**/*.local.md` - Ignored
- ✅ `.claude/settings.local.json` - Ignored

## 🎓 Examples

### Example 1: Simple Rule

```yaml
---
targets: ["*"]
root: false
description: Use async/await instead of promises
globs:
  - "src/**/*.ts"
cursor:
  alwaysApply: false
---

# Async/Await Guidelines

Always use async/await instead of raw promises for better readability.
```

### Example 2: Cursor-Only Rule

```yaml
---
targets: ["cursor"]
root: false
description: Cursor-specific keyboard shortcuts
globs: ["**/*"]
cursor:
  alwaysApply: true
---

# Cursor Shortcuts

- Cmd+K - AI chat
- Cmd+L - Inline edit
```

### Example 3: Root-Level Rule (Always Loaded)

```yaml
---
targets: ["*"]
root: true
description: Project-wide coding standards
---

# Coding Standards

These standards apply to all code in this repository...
```

## 🔗 Related Documentation

- [Rulesync README](../README.md)
- [Rulesync GitHub](https://github.com/dyoshikawa/rulesync)
- [Configuration File](../../rulesync.jsonc)

## ❓ Troubleshooting

### Problem: Rules not loading in AI Assistant (Cursor, Claude Code, ...)

**Solution:**
1. Check frontmatter is valid YAML
2. Run `yarn rulesync:generate`
3. Restart the AI Assistant

### Problem: Import doesn't work

**Solution:**
1. Check the files exist in `.cursor` or `.claude`
2. Ensure they have proper format
3. Run with specific target: `yarn rulesync:import:cursor`

### Problem: Git shows changes after generate

**Solution:** This is expected! The generated files should be committed along with the source files.
