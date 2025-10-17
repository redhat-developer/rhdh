# Extension Metadata Manager

An interactive command for managing RHDH Extensions Catalog metadata. This command can add new plugins, update existing plugins, and perform bulk updates like version bumps.
**Important**: Do not implement this as a standalone script. Execute steps interactively inside chat using the agent and built-in tools; do not generate shell or Node.js scripts from these instructions.
## Command Usage

This command is interactive and will guide you through the process. You can also provide parameters upfront to skip interactive prompts.

### Available Actions

1. **Add New Plugin** - Add a new plugin to the catalog
2. **Update Plugin** - Update an existing plugin's metadata
3. **Bump Version** - Update package version for a release
4. **Bulk Version Bump** - Update versions for multiple packages
5. **Validate Plugin** - Validate plugin and package YAML files

## Interactive Workflow

When you invoke this command, I'll ask you what you want to do unless you specify it upfront.

### Example Invocations

```
# Interactive mode - I'll ask what you want to do
Use extension metadata command

# Add a new plugin
Add aws-ecs plugin to extensions catalog

# Update existing plugin
Update 3scale plugin metadata

# Bump version for a specific plugin
Bump version for 3scale plugin to 3.9.0

# Bulk version bump for multiple plugins
Bump versions for all rhdh namespace plugins to match latest release
```

## Action Details

### 1. Add New Plugin

**What I'll need from you:**

If not provided, I'll interactively gather:

#### Required Information
- **Plugin name** (e.g., `aws-ecs`, `todo`)
- **NPM package name(s)** (e.g., `@aws/amazon-ecs-plugin-for-backstage`)
- **Namespace** (`rhdh` for Red Hat maintained, `community` for community plugins)
- **Plugin version**
- **Backstage version compatibility**
- **Role** (`frontend-plugin`, `backend-plugin`, or both)

#### User-Facing Information
- **Title** - Display name for the plugin
- **Short description** (2-3 lines for tile view)
- **Long description** (markdown, for expanded view)
- **Category** - One of: AI, Analytics, API Management, CI/CD, Cloud, Compliance, Cost, Developer Tools, Docs, Feature Flags, Kubernetes, Monitoring, Productivity, Reporting, Search, Security, Storage, Supply Chain, Testing
- **Tags** (lowercase, kebab-case)
- **Support level** (`production`, `tech-preview`, or `dev-preview`)

#### Links
- **Homepage/documentation URL**
- **Source code repository**
- **Bug tracker URL**

#### Optional Technical Details
- **OCI URL** (for overlay-built plugins)
- **Dynamic artifact path** (if not using OCI)
- **App config examples**

**What I'll do:**

1. Create feature branch: `add-{plugin-name}-plugin-metadata`
2. Generate package YAML(s) in `catalog-entities/marketplace/packages/` using the marketplace CLI:

```bash
npx --yes @red-hat-developer-hub/marketplace-cli generate \
  --namespace {namespace} \
  -p dynamic-plugins.default.yaml \
  -o catalog-entities/marketplace/packages
```

3. Create plugin YAML in `catalog-entities/marketplace/plugins/`
4. Update index files (`all.yaml`) in **alphabetical order**
5. Validate files against JSON schemas
6. Optionally test locally with rhdh-local
7. Create pull request with proper formatting

### 2. Update Plugin

**What I'll need from you:**

- **Plugin name** to update
- **What to update** (I'll show current values and ask what to change):
  - Title, description, tags, categories
  - Links (homepage, source, bugs)
  - Support level, lifecycle status
  - Package versions
  - Backstage compatibility versions
  - App config examples

**What I'll do:**

1. Read current plugin and package YAML(s)
2. Show you current values
3. Apply requested changes
4. Validate updated files
5. Create PR if on a branch, or commit changes

### 3. Bump Version

**What I'll need from you:**

- **Plugin name** or **package name**
- **New version number**
- **New Backstage compatibility version** (optional)

**What I'll do:**

1. Find all package YAML files for the plugin
2. Update version fields
3. Update Backstage compatibility if provided
4. Validate files
5. Create commit with descriptive message

### 4. Bulk Version Bump

**What I'll need from you:**

- **Filter criteria** (e.g., namespace, pattern, or "all")
- **Version update strategy**:
  - Specific version number for all
  - Version mapping from GitHub release
  - Increment strategy (major/minor/patch)
- **Backstage compatibility version** (optional)

**What I'll do:**

1. Query GitHub releases using `gh` CLI to find latest versions
2. Find all matching package files
3. Update versions according to strategy
4. Validate all updated files
5. Create PR with detailed changelog

**Example GitHub query:**
```bash
# Get latest release info
gh release view --repo redhat-developer/rhdh --json tagName,publishedAt

# Get version from dynamic-plugins.default.yaml in a release
gh api repos/redhat-developer/rhdh/contents/dynamic-plugins.default.yaml \
  --jq '.content' | base64 -d | yq '.plugins[] | select(.package == "@backstage-community/plugin-3scale-backend") | .version'
```

### 5. Validate Plugin

**What I'll need from you:**

- **Plugin name** or **package name** to validate

**What I'll do:**

1. Download JSON schemas from rhdh-plugins repo
2. Convert YAML to JSON
3. Validate against schemas using `ajv-cli`
4. Report any validation errors with helpful context
5. Check that entries exist in `all.yaml` files
6. Verify alphabetical ordering

## Prerequisites Check

Before executing any action, I'll verify you have required tools:

```bash
# Check for required tools
command -v yq &> /dev/null || echo "❌ Install yq (Go version): brew install yq"
command -v ajv &> /dev/null || echo "❌ Install ajv-cli: npm install -g ajv-cli"
command -v gh &> /dev/null || echo "❌ Install GitHub CLI: brew install gh"

# Verify yq is the Go version (mikefarah/yq)
yq --version | grep -q "mikefarah"
```

## Validation Process

For all actions that modify files, I'll:

1. **Schema Validation**
   ```bash
   # Download schemas
   mkdir -p /tmp/rhdh-schemas
   curl -s "https://raw.githubusercontent.com/redhat-developer/rhdh-plugins/main/workspaces/marketplace/json-schema/packages.json" \
     -o /tmp/rhdh-schemas/packages.json
   curl -s "https://raw.githubusercontent.com/redhat-developer/rhdh-plugins/main/workspaces/marketplace/json-schema/plugins.json" \
     -o /tmp/rhdh-schemas/plugins.json

   # Validate package
   yq eval packages/{plugin-name}.yaml -o json > /tmp/rhdh-schemas/package-temp.json
   ajv validate -s /tmp/rhdh-schemas/packages.json -d /tmp/rhdh-schemas/package-temp.json

   # Validate plugin
   yq eval plugins/{plugin-name}.yaml -o json > /tmp/rhdh-schemas/plugin-temp.json
   ajv validate -s /tmp/rhdh-schemas/plugins.json -d /tmp/rhdh-schemas/plugin-temp.json
   ```

2. **Alphabetical Order Check**
   - Verify entries in `all.yaml` files are alphabetically sorted
   - Fix ordering if needed

3. **Cross-Reference Check**
   - Verify plugin references existing packages
   - Check namespace consistency
   - Validate partOf relationships

4. **OCI Artifact Validation**

   For packages using OCI artifacts, verify tag matches versions:

   ```bash
   # Extract tag from OCI URL
   OCI_URL=$(yq eval '.spec.dynamicArtifact' packages/{package-name}.yaml)
   TAG=$(echo "$OCI_URL" | sed -E 's/.*:([^!]+).*/\1/')

   # Get versions from package
   PACKAGE_VERSION=$(yq eval '.spec.version' packages/{package-name}.yaml)
   BACKSTAGE_VERSION=$(yq eval '.spec.backstage.supportedVersions' packages/{package-name}.yaml)

   # Verify consistency
   EXPECTED_TAG="bs_${BACKSTAGE_VERSION}__${PACKAGE_VERSION}"

   if [ "$TAG" != "$EXPECTED_TAG" ]; then
     echo "❌ Tag mismatch!"
     echo "   Found: $TAG"
     echo "   Expected: $EXPECTED_TAG"
   else
     echo "✅ OCI tag matches package versions"
   fi
   ```

## Pull Request Creation

When creating PRs, I'll:

1. Create descriptive branch name
2. Stage only relevant files
3. Write detailed commit message following repo conventions
4. Generate PR with:
   - Clear summary of changes
   - Checklist of validation steps completed
   - Links to related issues/docs if applicable

**Example PR body:**
```markdown
## Summary
- Added/Updated {plugin-name} plugin metadata
- Package: `{npm-package}` version {version}
- Support level: {support-level}

## Changes
- [ ] Package YAML created/updated
- [ ] Plugin YAML created/updated
- [ ] Schemas validate successfully
- [ ] Added to all.yaml files alphabetically
- [ ] Tested locally (if applicable)

## Details
{Detailed description of what changed and why}
```

## Helper Utilities

### Query GitHub Container Registry (GHCR) for Package Versions

For plugins distributed via OCI artifacts from rhdh-plugin-export-overlays:

#### Get Latest Version for a Package

```bash
# Query latest tags for a package
# Replace {package-name} with the actual package name
gh api /orgs/redhat-developer/packages/container/rhdh-plugin-export-overlays%2F{package-name}/versions \
  --jq '.[0:5] | .[] | .metadata.container.tags[]' | grep -E '^bs_' | sort -V -r

# Example for dynatrace-backstage-plugin-dql:
gh api /orgs/redhat-developer/packages/container/rhdh-plugin-export-overlays%2Fdynatrace-backstage-plugin-dql/versions \
  --jq '.[0:5] | .[] | .metadata.container.tags[]' | grep -E '^bs_' | sort -V -r
```

#### Parse OCI Tag Format

OCI tags follow the format: `bs_{backstage_version}__{plugin_version}`

Examples:
- `bs_1.42.5__2.3.0` → Backstage 1.42.5, Plugin 2.3.0
- `bs_1.39.1__2.2.0` → Backstage 1.39.1, Plugin 2.2.0

To extract versions manually:
```bash
TAG="bs_1.42.5__2.3.0"
BACKSTAGE_VERSION=$(echo $TAG | sed -E 's/bs_([0-9.]+)__([0-9.]+)/\1/')
PLUGIN_VERSION=$(echo $TAG | sed -E 's/bs_([0-9.]+)__([0-9.]+)/\2/')
echo "Backstage: $BACKSTAGE_VERSION"
echo "Plugin: $PLUGIN_VERSION"
```

#### Find All GHCR-Based Packages

```bash
# List all packages using GHCR OCI artifacts
grep -l "ghcr.io/redhat-developer/rhdh-plugin-export-overlays" \
  catalog-entities/marketplace/packages/*.yaml
```

#### Verify OCI Artifact Exists

```bash
# Check if an OCI image is accessible (requires crane or skopeo)
crane manifest ghcr.io/redhat-developer/rhdh-plugin-export-overlays/dynatrace-backstage-plugin-dql:bs_1.42.5__2.3.0

# Or with skopeo:
skopeo inspect docker://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/dynatrace-backstage-plugin-dql:bs_1.42.5__2.3.0
```

### Query GitHub for Plugin Versions

```bash
# Get latest RHDH release
gh release view --repo redhat-developer/rhdh --json tagName,publishedAt,name

# Get plugin versions from a specific release
gh api repos/redhat-developer/rhdh/contents/dynamic-plugins.default.yaml?ref={tag} \
  --jq '.content' | base64 -d | yq '.plugins[] | [.package, .version] | @tsv'

# List all plugins in marketplace
ls -1 catalog-entities/marketplace/plugins/*.yaml | xargs -I {} basename {} .yaml
```

### Find Plugins by Criteria

```bash
# Find all rhdh namespace plugins
for f in catalog-entities/marketplace/plugins/*.yaml; do yq eval -e '.metadata.namespace == "rhdh"' "$f" >/dev/null && echo "$f"; done

# Find plugins by support level
yq eval 'select(.spec.support == "tech-preview") | .metadata.name' catalog-entities/marketplace/plugins/*.yaml

# Find outdated plugins (comparing to latest release)
# This is more complex and I'll handle it programmatically
```

## Error Handling

I'll handle common issues:

- **Wrong yq version**: Detect and provide installation instructions
- **Missing tools**: Check for all dependencies upfront
- **Schema validation failures**: Parse errors and suggest fixes
- **File conflicts**: Check for existing files and ask before overwriting
- **Git conflicts**: Check for clean working tree before making changes
- **Invalid categories/enums**: Show valid options when validation fails
- **OCI Tag Mismatch**: Parse OCI URL to verify tag matches declared versions
- **GHCR API Errors**: Ensure `gh` CLI is authenticated (`gh auth status`)
- **Package Not Found**: Verify package name encoding (use `%2F` for `/` in URLs)

## Advanced Features

### Version Mapping from Release

For RHDH releases, I can automatically map plugin versions:

```bash
# Download dynamic-plugins.default.yaml from release
gh api repos/redhat-developer/rhdh/contents/dynamic-plugins.default.yaml?ref=v1.4.0 \
  --jq '.content' | base64 -d > /tmp/dynamic-plugins-release.yaml

# Extract version mapping
yq eval '.plugins[] | [.package, .version] | @tsv' /tmp/dynamic-plugins-release.yaml
```

### Dependency Analysis

I can analyze which plugins depend on each other:

```bash
# Find all packages that are part of a plugin
yq eval 'select(.spec.partOf[] == "3scale") | .metadata.name' \
  catalog-entities/marketplace/packages/*.yaml
```

### Testing with rhdh-local

I can guide you through local testing:

1. Clone rhdh-local if not present
2. Generate docker compose mount config
3. Update app-config for faster catalog refresh
4. Provide test URLs and verification steps

## Real-World Example: Updating Dynatrace Plugin

This example demonstrates the complete workflow for updating a plugin from GHCR.

### Scenario
The dynatrace-backstage-plugin-dql has a version mismatch between its OCI tag and package metadata.

### Step 1: Identify the Issue

```bash
# Check current package metadata
yq eval '.spec.dynamicArtifact' catalog-entities/marketplace/packages/dynatrace-backstage-plugin-dql.yaml
# Output: oci://...dynatrace-backstage-plugin-dql:bs_1.39.1__2.2.0!...

yq eval '.spec.backstage.supportedVersions' catalog-entities/marketplace/packages/dynatrace-backstage-plugin-dql.yaml
# Output: 1.35.1

# Issue: OCI tag shows bs_1.39.1 but supportedVersions shows 1.35.1
```

### Step 2: Query GHCR for Latest

```bash
gh api /orgs/redhat-developer/packages/container/rhdh-plugin-export-overlays%2Fdynatrace-backstage-plugin-dql/versions \
  --jq '.[0:5] | .[] | .metadata.container.tags[]' | grep -E '^bs_' | sort -V -r | head -3
```

### Step 3: Update Package Files

If only fixing mismatch (no newer version):
- Update `spec.backstage.supportedVersions` to match OCI tag (1.39.1)
- Update both frontend and backend packages

If newer version available (e.g., bs_1.42.5__2.3.0):
- Update `spec.version` to 2.3.0
- Update `spec.backstage.supportedVersions` to 1.42.5
- Update `spec.dynamicArtifact` OCI URL with new tag

### Step 4: Validate

```bash
cd catalog-entities/marketplace

# Validate YAML syntax
yq eval packages/dynatrace-backstage-plugin-dql.yaml > /dev/null && echo "✅ Valid"
yq eval packages/dynatrace-backstage-plugin-dql-backend.yaml > /dev/null && echo "✅ Valid"
```

### Step 5: Create PR

```bash
git checkout -b update-dynatrace-plugin-metadata
git add packages/dynatrace-backstage-plugin-dql*.yaml
git commit -m "chore: update dynatrace plugin to version 2.3.0"
git push -u origin update-dynatrace-plugin-metadata
gh pr create --title "chore: update dynatrace plugin to version 2.3.0" \
  --body "Updated to latest version from GHCR (2.2.0 → 2.3.0)"
```

### Key Learnings

1. **OCI tags are source of truth** - The tag `bs_X.Y.Z__A.B.C` defines both versions
2. **Update packages together** - Frontend and backend must stay in sync
3. **Validate before PR** - Always run YAML syntax validation
4. **URL encoding** - Package names with `/` become `%2F` in API calls
5. **Version consistency** - The OCI tag format ensures backstage and plugin versions are always tracked together

### Real PR Example

See [PR #3549](https://github.com/redhat-developer/rhdh/pull/3549) for the actual implementation of this workflow.

## References

- [Marketplace README](../../catalog-entities/marketplace/README.md)
- [Extension Schemas](https://github.com/redhat-developer/rhdh-plugins/tree/main/workspaces/marketplace/json-schema)
- [RHDH Local Testing](https://github.com/redhat-developer/rhdh-local)
- [Dynamic Plugins Documentation](https://docs.redhat.com/en/documentation/red_hat_developer_hub)
- [Cursor Commands Documentation](https://cursor.com/docs/agent/chat/commands)

## Notes

- This command follows the workflow from `.cursor/rules/add_extension_metadata.mdc` but is more flexible
- Always maintains alphabetical order in index files
- Validates all changes before committing
- Provides helpful error messages and suggestions
- Can be used in both interactive and non-interactive modes
- Integrates with GitHub CLI for version lookups
