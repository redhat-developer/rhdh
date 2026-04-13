# install-dynamic-plugins

Init-container utility that downloads, extracts, and configures RHDH dynamic plugins listed in a `dynamic-plugins.yaml` file.

This package replaces the previous Python implementation (`install-dynamic-plugins.py`) with a TypeScript/Node.js implementation. The runtime contract — input config, output `app-config.dynamic-plugins.yaml`, on-disk layout, hash-based change detection, lock file — is **unchanged**.

## How it runs in the RHDH container

The container's init container invokes the wrapper:

```sh
./install-dynamic-plugins.sh /dynamic-plugins-root
```

The wrapper executes the bundled CommonJS entry point with Node.js:

```sh
exec node install-dynamic-plugins.cjs "$1"
```

Both files live at `/opt/app-root/src/` inside the runtime image. Node.js 22 is already present (it runs the Backstage backend), and `skopeo` is installed for OCI inspection — no new system packages are required.

## Architecture

```
src/
├── index.ts              # main() — argv + orchestration of the full install flow
├── log.ts                # uniform stdout logger
├── errors.ts             # InstallException
├── types.ts              # PluginSpec / Plugin / PluginMap / PullPolicy + constants
├── util.ts               # shared helpers (fileExists, isInside, isPlainObject, tar filters)
├── run.ts                # subprocess wrapper with structured errors
├── concurrency.ts        # Semaphore + mapConcurrent + getWorkers()
├── which.ts              # PATH lookup (no `which` dep)
├── skopeo.ts             # Skopeo wrapper with promise-based inspect cache
├── image-resolver.ts     # registry.access.redhat.com → quay.io fallback
├── image-cache.ts        # OciImageCache — share OCI tarballs across plugins
├── tar-extract.ts        # streaming OCI / NPM extraction with security checks
├── npm-key.ts            # NPM package-spec parsing
├── oci-key.ts            # OCI package-spec parsing + {{inherit}} + auto-path
├── integrity.ts          # streaming SRI integrity verification
├── merger.ts             # plugin merging + deep-merge with conflict detection
├── plugin-hash.ts        # hash for change-detection ("already installed?")
├── installer-oci.ts      # install one OCI plugin
├── installer-npm.ts      # install one NPM (or local) plugin
├── catalog-index.ts      # CATALOG_INDEX_IMAGE extraction
└── lock-file.ts          # exclusive lock + SIGTERM cleanup
```

### Concurrency strategy (resource-conscious)

OCI plugin downloads are parallelized via `mapConcurrent`. NPM `npm pack` calls stay sequential because the upstream npm registry throttles parallel fetches.

The default worker count comes from `getWorkers()`:

```
Math.max(1, Math.min(Math.floor(availableParallelism() / 2), 6))
```

`availableParallelism()` honours cgroup CPU limits, so init containers in OpenShift won't try to use 16 workers on a 0.5 CPU pod. Override with `DYNAMIC_PLUGINS_WORKERS=<n>`.

### Memory budget

All tar extraction is streaming via `node-tar` — large layers never load into RAM. SHA verification streams chunks through `node:crypto`. A typical 10-plugin run sits around 20–80 MB peak RSS, comfortably below an init-container memory limit of 512 Mi.

### Security checks (parity with the previous Python script)

| Check                                                                 | Source                               |
| --------------------------------------------------------------------- | ------------------------------------ |
| Path-traversal in plugin path (`..`, absolute paths)                  | `tar-extract.ts`                     |
| Per-entry size cap (zip bomb) — `MAX_ENTRY_SIZE`, default 20 MB       | `tar-extract.ts`, `catalog-index.ts` |
| Symlink / hardlink target must stay inside destination                | `tar-extract.ts`                     |
| Reject device files / FIFOs / unknown entry types                     | `tar-extract.ts`                     |
| `package/` prefix enforced for NPM tarballs                           | `tar-extract.ts`                     |
| SRI integrity verification (`sha256` / `sha384` / `sha512`)           | `integrity.ts`                       |
| Registry fallback: `registry.access.redhat.com/rhdh` → `quay.io/rhdh` | `image-resolver.ts`                  |

## Environment variables

| Variable                       | Default              | Purpose                                                                                                |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `MAX_ENTRY_SIZE`               | `20000000`           | Per-entry byte limit when extracting tarballs                                                          |
| `SKIP_INTEGRITY_CHECK`         | `false`              | When `true`, skip the SRI integrity check for remote NPM packages                                      |
| `CATALOG_INDEX_IMAGE`          | _(unset)_            | OCI image to extract `dynamic-plugins.default.yaml` and catalog entities from                          |
| `CATALOG_ENTITIES_EXTRACT_DIR` | `$TMPDIR/extensions` | Where to extract `catalog-entities/` from the catalog-index image                                      |
| `DYNAMIC_PLUGINS_WORKERS`      | `auto`               | Worker count override for parallel OCI downloads (`auto` uses `availableParallelism()/2`, capped at 6) |
| `DYNAMIC_PLUGINS_LOCK_TIMEOUT_MS` | `600000` (10 min)   | Max time to wait for the lock file before aborting with an error                                         |

## Development

```sh
npm install
npm run tsc       # type-check
npm test          # Jest unit tests (105 tests)
npm run build     # produce dist/install-dynamic-plugins.cjs
```

`dist/install-dynamic-plugins.cjs` **is** committed to the repo (consumed directly by the Containerfile, similar to `.yarn/releases/yarn-*.cjs`). The PR check verifies the bundle is up to date relative to the source.

## Testing in CI

The CI workflow (`.github/workflows/pr.yaml`) runs:

1. `npm install && npm run tsc && npm test` — type check + Jest unit tests
2. `npm run build` and a `git diff` check on the committed `dist/install-dynamic-plugins.cjs`

## Compatibility notes

- The **input contract** matches the previous Python script exactly: same `dynamic-plugins.yaml` schema (`includes`, `plugins`, `package`, `pluginConfig`, `disabled`, `pullPolicy`, `forceDownload`, `integrity`).
- The **output contract** matches: same `app-config.dynamic-plugins.yaml`, same plugin directory layout, same `dynamic-plugin-config.hash` / `dynamic-plugin-image.hash` files.
- `{{inherit}}` semantics, OCI path auto-detection, registry fallback, integrity algorithms, lock-file behaviour are preserved.
