# Sanity Plugin Check - POC

Validates that all RHDH dynamic plugins can be loaded by Backstage, without requiring a Kubernetes cluster or container deployment.

## What this POC does

### Phase 1: Plugin Loadability (Jest + startTestBackend)

Downloads all plugin packages from the RHDH catalog index OCI image, then starts a Backstage test backend with every backend plugin loaded simultaneously. Frontend plugins are validated by checking that their bundle artifacts exist.

- **Extracts** the catalog index via `install-dynamic-plugins-fast.py` (optimized rewrite with parallel OCI downloads)
- **Loads** all backend plugins into `startTestBackend` from `@backstage/backend-test-utils`
- **Validates** frontend plugin bundles have `dist-scalprum/plugin-manifest.json`
- **Reports** which plugins loaded and which failed

**Time:** ~3 minutes extraction + ~2 seconds testing

### Phase 2: E2E Browser Tests (Playwright)

Starts the real Backstage backend (`yarn start`) with dynamic plugins loaded from the catalog index, then runs the same Playwright specs used by `showcase-sanity-plugins` in CI.

- **Reuses** existing spec files from `e2e-tests/playwright/` (no copying)
- **Loads** OCI plugins into `dynamic-plugins-root/` via `install-dynamic-plugins-fast.py`
- **Serves** frontend via `@backstage/plugin-app-backend` with scalprum dynamic plugin loading
- **Runs** Playwright against `http://localhost:7007`

**Time:** ~3 minutes extraction + ~15 seconds backend startup + ~1 minute Playwright

## Current status

| Test | Phase 1 (Jest) | Phase 2 (Playwright) |
|------|---------------|---------------------|
| Backend plugins load | 15/15 pass | N/A |
| Frontend bundles valid | 14/14 pass | N/A |
| `instance-health-check.spec.ts` | N/A | Pass |
| `home-page-customization.spec.ts` | N/A | **Fails** (1) |
| `sidebar.spec.ts` | N/A | **Fails** (1) |
| `catalog-timestamp.spec.ts` | N/A | Not tested (2) |

**(1)** These tests depend on **local plugins** (`./dynamic-plugins/dist/...`) that are not available as OCI images yet: `dynamic-home-page`, `global-header`, `quickstart`, `techdocs`, etc. The RHDH frontend renders and guest login works, but the homepage shows 404 because no plugin registers the `/` route.

**(2)** Requires catalog entities and GitHub credentials.

## What needs to change for all tests to pass

### RHDH 1.10 (when all plugins are OCI)

When local wrappers are removed and all plugins are published as OCI images (planned for 1.10), the POC will work end-to-end without any wrapper builds. The `install-dynamic-plugins-fast.py` will download everything automatically, including homepage, global-header, techdocs, and other RHDH-specific plugins that currently only exist as local wrappers.

At that point:
1. All 4 sanity Playwright tests should pass
2. No `yarn install` in `dynamic-plugins/` needed
3. No `yarn export-dynamic` needed
4. The only setup is: extract catalog index + install plugins + build frontend + start backend

### Short-term (current codebase, pre-1.10)

1. **Phase 1 works fully today**: All OCI backend plugins load via `startTestBackend`, frontend bundles are validated.
2. **Phase 2 partially works**: Backend starts with 21 frontend + 17 backend dynamic plugins loaded. Health check passes. Browser tests fail only because ~15 RHDH-specific plugins (homepage, header, sidebar config) are still local wrappers, not OCI images.
3. **Config stubs**: Some plugins validate config at startup and need dummy values in `app-config.local.yaml`.

### In `install-dynamic-plugins-fast.py`

4. **Local plugin skip**: The fast installer skips local plugins that don't exist on disk (instead of crashing). It still merges their `pluginConfig` into the global config so the frontend knows about them. This is critical for running outside the container.

## How to run

### Prerequisites

- `skopeo` installed (`brew install skopeo` on macOS)
- `python3` with `pyyaml` (`pip3 install pyyaml`)
- Node.js 22+, yarn
- Playwright browsers (`npx playwright install chromium`)

### Phase 1: Plugin Loadability

```bash
cd sanity-plugin-check

# Extract all plugins from catalog index (~3 min)
bash scripts/extract-plugins.sh 1.10

# Install test dependencies
npm install

# Run Jest tests (~2 seconds)
npx jest --forceExit
```

### Phase 2: E2E Browser Tests

```bash
# From the repo root:

# 1. Install repo dependencies
yarn install

# 2. Build the frontend (~23 seconds)
cd packages/app && yarn build && cd ../..

# 3. Install OCI plugins into dynamic-plugins-root
DPROOT="dynamic-plugins-root"

# Extract catalog index
CATALOG_DIR="/tmp/rhdh-catalog-idx"
rm -rf "$CATALOG_DIR"; mkdir -p "$CATALOG_DIR/oci" "$CATALOG_DIR/content"
skopeo copy --override-os=linux --override-arch=amd64 \
  "docker://quay.io/rhdh/plugin-catalog-index:1.10" "dir:${CATALOG_DIR}/oci"
for layer in $(jq -r '.layers[].digest' "${CATALOG_DIR}/oci/manifest.json" | sed 's/sha256://'); do
  tar -xf "${CATALOG_DIR}/oci/${layer}" -C "${CATALOG_DIR}/content/" 2>/dev/null || true
done

# Generate override and install
cp "${CATALOG_DIR}/content/dynamic-plugins.default.yaml" "$DPROOT/"
python3 -c "
import yaml
with open('${DPROOT}/dynamic-plugins.default.yaml') as f:
    data = yaml.safe_load(f)
overrides = []
for p in data['plugins']:
    pkg = p['package']
    if pkg.startswith('./'):
        overrides.append({'package': pkg, 'disabled': True})
    elif pkg.startswith('oci://') and p.get('disabled', False):
        overrides.append({'package': pkg, 'disabled': False})
result = {'includes': ['dynamic-plugins.default.yaml'], 'plugins': overrides}
with open('${DPROOT}/dynamic-plugins.yaml', 'w') as f:
    yaml.safe_dump(result, f, default_flow_style=False)
"

cd "$DPROOT" && SKIP_INTEGRITY_CHECK=true \
  python3 scripts/install-dynamic-plugins/install-dynamic-plugins-fast.py "$DPROOT/"

# Clean non-plugin dirs
rm -rf "$DPROOT/.catalog-content" "$DPROOT/.catalog-index" "$DPROOT/.catalog-index-temp"
rm -rf "$DPROOT/roadiehq-backstage-plugin-argo-cd-backend"  # conflicts with community argocd

# 4. Create app-config.local.yaml (see below)

# 5. Start backend and run tests
cd packages/backend && NODE_OPTIONS="--no-node-snapshot" yarn start &
sleep 15
cd e2e-tests && BASE_URL="http://localhost:7007" npx playwright test \
  playwright/e2e/instance-health-check.spec.ts \
  --reporter=list --project=any-test
```

### Required `app-config.local.yaml`

Place at the repo root. Auto-loaded by Backstage.

```yaml
app:
  baseUrl: http://localhost:7007

auth:
  environment: development
  providers:
    guest: {}

dynamicPlugins:
  frontend: {}

# Stubs for plugins that validate config at startup
integrations:
  gitlab:
    - host: gitlab.com
      token: dummy

quay:
  uiUrl: https://quay.io
  apiUrl: https://quay.io/api/v1

jenkins:
  baseUrl: http://localhost:8080
  username: test
  apiKey: test

argocd:
  appLocatorMethods:
    - type: config
      instances: []

orchestrator:
  dataIndexService:
    url: http://localhost:8080
  workflowLogProvider:
    loki:
      url: http://localhost:3100
      baseUrl: http://localhost:3100

dynatrace:
  baseUrl: http://localhost:9999

lighthouse:
  baseUrl: http://localhost:9999
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  quay.io/rhdh/plugin-catalog-index:1.10              │
│  (OCI image with dynamic-plugins.default.yaml)       │
└───────────────────────┬──────────────────────────────┘
                        │ skopeo copy
                        ▼
┌──────────────────────────────────────────────────────┐
│  install-dynamic-plugins-fast.py                      │
│  - Parallel OCI downloads (5 workers)                 │
│  - Shared image cache                                 │
│  - Skips missing local plugins (merges their config)  │
│  - Generates app-config.dynamic-plugins.yaml          │
└───────────────────────┬──────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
┌─────────────────────┐  ┌─────────────────────────────┐
│  Phase 1: Jest       │  │  Phase 2: Playwright         │
│                      │  │                              │
│  startTestBackend    │  │  yarn start (real backend)   │
│  + all backend       │  │  + app-backend (frontend)    │
│    plugins loaded    │  │  + scalprum (dynamic FE)     │
│  + frontend bundle   │  │  + guest auth                │
│    validation        │  │                              │
│                      │  │  Reuses existing specs from   │
│  ~2 seconds          │  │  e2e-tests/playwright/       │
└─────────────────────┘  └─────────────────────────────┘
```

## Files

```
sanity-plugin-check/
├── scripts/
│   └── extract-plugins.sh           # Extracts catalog index + OCI plugins
├── src/
│   ├── types.ts                     # Shared types
│   ├── config.ts                    # KNOWN_FAILURES, CONFIG_OVERRIDES
│   ├── setup.ts                     # Module resolution patch for peer deps
│   ├── plugin-loader.ts             # loadManifest, loadBackendPlugins, validateFrontendBundle
│   ├── reporter.ts                  # Structured test output
│   └── plugin-loadability.test.ts   # Phase 1 Jest test
├── playwright.config.ts             # Phase 2 Playwright config (reuses existing specs)
├── app-config.sanity-test.yaml      # Config overlay (alternative to app-config.local.yaml)
├── jest.config.ts
├── tsconfig.json
├── package.json
└── README.md

scripts/install-dynamic-plugins/
├── install-dynamic-plugins.py       # Original (unchanged)
└── install-dynamic-plugins-fast.py  # Optimized rewrite with parallel downloads + local skip
```

## Performance comparison

| Approach | Setup | Test | Total |
|----------|-------|------|-------|
| CI (cluster + deploy + all test suites) | ~60 min | ~1 min | **~61 min** |
| CI (standalone sanity-plugins only) | ~15 min | ~1 min | **~16 min** |
| Phase 1 (Jest, plugin loadability) | ~3 min | ~2 sec | **~3 min** |
| Phase 2 (Playwright, e2e browser) | ~3 min + ~23s build | ~1 min | **~4.5 min** |

## Known limitations

1. **Local plugins not available as OCI**: ~15 RHDH-specific plugins (homepage, header, techdocs wrappers) are only in `./dynamic-plugins/dist/` which doesn't exist outside the container. These will become OCI images in 1.10.

2. **Orchestrator plugins require auth**: 5 orchestrator plugins from `registry.access.redhat.com` require authentication to download.

3. **Plugin ID conflicts**: `roadiehq-backstage-plugin-argo-cd-backend` and `backstage-community-plugin-argocd-backend` both register `pluginId: argocd`. Only one can be loaded at a time.

4. **Config stubs needed**: Some plugins validate config at startup and need dummy values even when not actively used.

5. **Frontend build required for Phase 2**: `packages/app/dist/` must exist. Takes ~23 seconds to build.
