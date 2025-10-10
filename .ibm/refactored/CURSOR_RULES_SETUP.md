# How to Use Cursor Rules for the Refactored Architecture

## 📚 Created Files

**2 files** were created to ensure Cursor AI follows the modular architecture best practices:

### 1. `.cursorrules` (15KB, 500 lines)
- **Cursor rules file** that AI reads automatically
- Concise and direct rules for code generation
- Directory structure, templates, and anti-patterns

### 2. `docs/development-guide.md` (57KB, 1609 lines)  
- **Complete development guide** for developers and AI
- Detailed documentation with practical examples
- Complete reference for modules, patterns, and troubleshooting

---

## 🎯 How Cursor Uses These Files

### `.cursorrules` (Automatic)

Cursor **automatically reads** `.cursorrules` files in the working directory when you:
1. Open a file in this folder
2. Use `@directory` to reference `.ibm/refactored/`
3. Ask AI to generate code in this folder

**The AI will**:
- ✅ Follow the modular structure
- ✅ Use logging functions (`log_*`)
- ✅ Add guards in modules
- ✅ Export functions correctly
- ✅ Avoid anti-patterns (echo, hardcoded values, etc.)
- ✅ Document functions properly

### `docs/development-guide.md` (Automatic via `.cursorrules`)

The `.cursorrules` file now references `@docs/development-guide.md`, so the AI **automatically loads**:
- Detailed architecture reference
- Complete code examples
- Troubleshooting and debugging guides
- Design decisions

**How it works**:
```bash
# When you work in .ibm/refactored/:
Cursor loads .cursorrules automatically
    ↓
.cursorrules references @docs/development-guide.md
    ↓
AI has complete context automatically!
```

---

## 🚀 How to Configure in Cursor

### Option 1: Automatic (Recommended)

`.cursorrules` files are **automatically loaded** when you:

1. **Open the directory** `.ibm/refactored/` in Cursor
2. **Work on files** inside `.ibm/refactored/`

**Test**:
```bash
# Open any file in .ibm/refactored/
# Ask the AI:
"Create a new function to delete pods in a namespace"

# The AI should automatically follow the rules:
# - Use log_* functions
# - Add documentation
# - Validate inputs
# - Export function
```

### Option 2: Create Global Rule

If you want the rules to apply **globally** in the project:

1. **Create** `.cursor/rules/refactored-architecture.md`
2. **Copy** the content from `.cursorrules` there
3. **Add** to the header:
```markdown
---
title: RHDH Refactored Architecture
description: Architecture rules for .ibm/refactored/
applies_to: ".ibm/refactored/**/*.sh"
---
```

### Option 3: Reference in Root .cursorrules

If you already have a `.cursorrules` in the project root:

```bash
# Add to root .cursorrules:
# For .ibm/refactored/ directory, follow:
@.ibm/refactored/.cursorrules
```

---

## 💡 Usage Examples

### Example 1: Create New Function

**You ask**:
```
Create a function to deploy Redis in a namespace
```

**AI generates (following .cursorrules)**:
```bash
# Deploy Redis to specified namespace
#
# Deploys Redis cache using ConfigMaps and Deployments.
# Validates namespace exists before deploying.
#
# Args:
#   $1 - namespace: Target Kubernetes namespace
#
# Returns:
#   0 on success
#   1 on failure
#
# Example:
#   deploy_redis "showcase"
#
deploy_redis() {
    local namespace="$1"
    
    # Validate input
    if [[ -z "${namespace}" ]]; then
        log_error "namespace is required"
        return 1
    fi
    
    log_info "Deploying Redis to ${namespace}"
    
    # Deploy Redis resources
    kubectl apply -f "${DIR}/resources/redis-cache/" -n "${namespace}"
    
    # Wait for Redis to be ready
    kubectl wait --for=condition=ready pod -l app=redis \
        -n "${namespace}" --timeout=60s
    
    log_success "Redis deployed successfully"
    return 0
}

export -f deploy_redis
```

**Notice**:
- ✅ Complete documentation
- ✅ Input validation
- ✅ Use of `log_*` functions
- ✅ Function exported
- ✅ Error handling

### Example 2: Create New Job

**You ask**:
```
Create a job to test Keycloak integration
```

**AI generates (following .cursorrules)**:
```bash
#!/usr/bin/env bash
#
# Job: keycloak-integration - Test Keycloak integration
#

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load all modules
source "${DIR}/modules/bootstrap.sh"

# ============================================================================
# MAIN JOB LOGIC
# ============================================================================

main() {
    log_section "Keycloak Integration Tests"
    
    # Pre-flight checks
    preflight_checks
    
    # Validate Keycloak is configured
    if [[ -z "${KEYCLOAK_AUTH_BASE_URL:-}" ]]; then
        log_error "KEYCLOAK_AUTH_BASE_URL is not set"
        return 1
    fi
    
    log_info "Testing Keycloak integration"
    
    # Run tests
    # ... test logic here
    
    log_success "Keycloak integration tests completed"
}

# Execute main function
main "$@"
```

**Notice**:
- ✅ Standard job structure
- ✅ Bootstrap loaded
- ✅ Pre-flight checks
- ✅ Env var validation
- ✅ Appropriate logging

### Example 3: Add to Existing Module

**You ask**:
```
Add a function in k8s-operations.sh to get status of all pods
```

**AI adds (following .cursorrules)**:
```bash
# Get status of all pods in namespace
#
# Retrieves pod status including name, status, and restarts.
# Formats output as a table for easy reading.
#
# Args:
#   $1 - namespace: Kubernetes namespace
#
# Returns:
#   0 on success
#   1 if namespace doesn't exist
#
# Example:
#   get_all_pod_status "showcase"
#
get_all_pod_status() {
    local namespace="$1"
    
    if [[ -z "${namespace}" ]]; then
        log_error "namespace is required"
        return 1
    fi
    
    if ! kubectl get namespace "${namespace}" &>/dev/null; then
        log_error "Namespace ${namespace} does not exist"
        return 1
    fi
    
    log_info "Getting pod status in ${namespace}"
    
    kubectl get pods -n "${namespace}" \
        -o custom-columns=\
NAME:.metadata.name,\
STATUS:.status.phase,\
RESTARTS:.status.containerStatuses[0].restartCount
    
    return 0
}

# Add to exports section
export -f get_all_pod_status
```

**Notice**:
- ✅ Adds to correct module
- ✅ Follows existing pattern
- ✅ Adds to export

---

## 🔍 Verifying It's Working

### Test 1: Ask for Simple Code

```
Create a function that validates if a namespace exists
```

**Expected**: Function with log_*, validation, export

### Test 2: Ask for Refactoring

```
Refactor this code to follow best practices:

echo "Deploying app"
kubectl apply -f app.yaml
echo "Done"
```

**Expected**: Code with log_*, error handling, retry

### Test 3: Ask for New Module

```
Create a new module for Secret management operations
```

**Expected**: File with guard, exports, documentation

---

## 📋 Quality Checklist

Use this checklist to verify generated code follows the rules:

### Structure
- [ ] Uses `set -euo pipefail`
- [ ] Has guard to prevent double-sourcing
- [ ] Sources dependencies correctly
- [ ] Exports all public functions

### Documentation
- [ ] File header present
- [ ] Each function documented (args, returns, example)
- [ ] Comments explain **why**, not **what**

### Code
- [ ] Uses `log_*` functions (not `echo`)
- [ ] Variables quoted (`"${var}"`)
- [ ] Local variables declared (`local var`)
- [ ] Error handling present
- [ ] Input validation present

### Patterns
- [ ] Follows naming conventions (snake_case)
- [ ] Uses constants (not hardcoded values)
- [ ] No duplicated code
- [ ] Uses retry for flaky operations

---

## 🎓 Training the AI

### When AI Makes Mistakes

If AI generates code that **doesn't follow the rules**:

**1. Correct explicitly**:
```
This code doesn't follow the architecture rules.
@.cursorrules Please correct to use log_* functions and add documentation.
```

**2. Reinforce the rule**:
```
Remember: NEVER use echo. Always use log_info, log_error, etc.
See @.cursorrules for details.
```

**3. Show example**:
```
Here's how it should be:
[paste correct example from docs/development-guide.md]
```

### When AI Gets It Right

When AI generates code **following the rules**, reinforce:

```
✅ Perfect! This code follows the architecture rules exactly.
Keep it up.
```

---

## 🛠️ Maintaining the Rules

### When to Update

Update `.cursorrules` and `docs/development-guide.md` when:

1. **New convention** is adopted
2. **New module type** is created
3. **Better pattern** is discovered
4. **Anti-pattern** is identified

### How to Update

```bash
# 1. Edit .cursorrules (for concise AI rules)
vim .ibm/refactored/.cursorrules

# 2. Edit development-guide.md (for detailed documentation)
vim .ibm/refactored/docs/development-guide.md

# 3. Test with AI
# Ask for code and see if it follows the new rules

# 4. Commit
git add .ibm/refactored/.cursorrules .ibm/refactored/docs/development-guide.md
git commit -m "docs: update architecture rules"
```

---

## 📚 Additional Resources

### Related Documentation

- **README.md** - How to use the scripts
- **docs/architecture.md** - Architecture diagrams and overview
- **docs/development-guide.md** - Complete development guide (auto-loaded by AI)
- **.cursorrules** - Rules for AI (auto-loaded)

### For Developers

1. **Read first**: `README.md` and `docs/development-guide.md`
2. **Explore**: Browse `modules/` to understand structure
3. **Use as reference**: `.cursorrules` when coding
4. **Test**: Use `make deploy` locally

### For AI/Cursor

1. **Load**: `.cursorrules` automatically
2. **Load**: `@docs/development-guide.md` automatically (via .cursorrules)
3. **Follow**: All defined patterns
4. **Avoid**: All listed anti-patterns

---

## ✅ Summary

| File | Purpose | When Used |
|------|---------|-----------|
| `.cursorrules` | AI rules | Automatic when working in folder |
| `docs/development-guide.md` | Complete reference | Auto-loaded via .cursorrules ⭐ |
| `docs/architecture.md` | Diagrams and overview | To understand the system |
| `CURSOR_RULES_SETUP.md` | This file - Setup guide | Read as tutorial |

**With these files, Cursor AI will**:
- ✅ Generate code following modular architecture
- ✅ Use logging functions correctly
- ✅ Add proper documentation
- ✅ Validate inputs and handle errors
- ✅ Avoid common anti-patterns
- ✅ Follow naming conventions
- ✅ Export functions correctly

**Result**: Consistent, maintainable, and high-quality code! 🚀

---

**Created**: 2025-10-09  
**Updated**: 2025-10-09  
**Version**: 1.1
