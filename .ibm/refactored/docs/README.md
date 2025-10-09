# RHDH CI/CD Scripts - Documentation Index

## 📚 Available Documentation

> **⚡ Quick Start**: See [../README.md](../README.md) for user guide and quick start

### 👤 For Users

| Document | Description | Audience |
|----------|-------------|----------|
| [README.md](../README.md) | User guide, quick start, available jobs | Users, Operators |
| [CURSOR_RULES_SETUP.md](../CURSOR_RULES_SETUP.md) | How to use Cursor rules for AI code generation | Developers |

### 🏗️ For Developers

| Document | Description | Audience |
|----------|-------------|----------|
| [architecture.md](architecture.md) | System overview, diagrams, flows | Developers, Architects |
| [development-guide.md](development-guide.md) | Complete development guide, patterns, templates | Developers, Contributors |
| [../.cursorrules](../.cursorrules) | Cursor AI code generation rules | AI, Developers |

### 📖 Reading Order

**If you're new to this codebase:**

1. **Start**: [README.md](../README.md) - Understand what the system does
2. **Understand**: [architecture.md](architecture.md) - See diagrams and flows
3. **Develop**: [development-guide.md](development-guide.md) - Learn how to add code

**If you're using Cursor AI:**

1. **Let AI read**: [../.cursorrules](../.cursorrules) - Loaded automatically
2. **Reference**: `@development-guide.md` - For detailed examples
3. **Check**: [architecture.md](architecture.md) - For system overview

---

## 📄 Document Details

### README.md (Main User Guide)

**Topics:**
- Quick start guide
- Available jobs (deploy, test, cleanup, nightly, etc.)
- Makefile commands
- Environment variables
- Local configuration
- Troubleshooting

**When to read:** When you want to **use** the scripts

### architecture.md (System Overview)

**Topics:**
- Architecture diagrams (Mermaid)
- Execution flows
- Module structure
- Environment variables
- Orchestrator strategy
- Resource usage

**When to read:** When you want to **understand** the system

### development-guide.md (Development Guide)

**Topics:**
- Architecture principles
- Directory structure
- Module system
- Code style guide
- Testing guidelines
- Common patterns
- Anti-patterns
- Integration points
- Troubleshooting
- Quick reference

**When to read:** When you want to **develop** or **extend** the system

### .cursorrules (AI Rules)

**Topics:**
- Core principles
- Directory structure
- Code templates
- Anti-patterns
- Quick reference for code generation

**When to read:** Used **automatically** by Cursor AI

---

## 🎯 Quick Navigation

### I want to...

| Task | Document |
|------|----------|
| Deploy RHDH | [README.md](../README.md) |
| Understand the architecture | [architecture.md](architecture.md) |
| Add a new function | [development-guide.md](development-guide.md) |
| Add a new job | [development-guide.md](development-guide.md) |
| Add a new module | [development-guide.md](development-guide.md) |
| Understand module dependencies | [architecture.md](architecture.md) |
| See execution flows | [architecture.md](architecture.md) |
| Learn code patterns | [development-guide.md](development-guide.md) |
| Configure local environment | [README.md](../README.md) |
| Troubleshoot issues | [development-guide.md](development-guide.md) |

---

## 🔄 Document Relationships

```
README.md (User Guide)
    ↓
    Uses & References
    ↓
architecture.md (System Overview)
    ↓
    Detailed Implementation
    ↓
development-guide.md (Development Patterns)
    ↓
    Used by AI
    ↓
.cursorrules (AI Rules)
```

---

## 📝 Maintenance

### When to Update

Update documentation when:
- ✅ New module is added
- ✅ New job is created
- ✅ Architecture changes
- ✅ New pattern is adopted
- ✅ Anti-pattern is identified

### How to Update

1. **User-facing changes**: Update [README.md](../README.md)
2. **Architecture changes**: Update [architecture.md](architecture.md)
3. **Development patterns**: Update [development-guide.md](development-guide.md)
4. **AI rules**: Update [../.cursorrules](../.cursorrules)

---

**Last Updated**: 2025-10-09  
**Version**: 2.0  
**Maintainers**: RHDH CI/CD Team

