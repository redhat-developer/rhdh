# ScriptC PoC findings (RHDH)

Throwaway investigation of [vercel-labs/scriptc](https://github.com/vercel-labs/scriptc) against Red Hat Developer Hub. This is not production code and not a second Hub backend.

**Question:** Can we compile TypeScript to a native binary, ship it in a Linux container on Windows, compare it to Node on size/memory/startup, and get anywhere near the real Hub backend (including dynamic plugins)?

**Short answers:**

- Trimmed Linux PoC on Windows: yes. Image size and RSS look good.
- Full `packages/backend` with dynamic plugins: no, not with the current scriptc model.
- Sensible next backend-like compile: `04-core-static-plugins` (fixed plugin set, no dynamic loader).

---

## Package layout

| Path | Role |
|---|---|
| `packages/backend-scriptc/` | Sibling package for the PoC (not under `packages/backend/`) |
| `src/main.ts` | Trimmed HTTP entry used for images and benches |
| `src/entries/02-…` … `05-…` | Coverage ladder toward backend / dynamic plugins |
| `Containerfile.poc` | Multi-stage ScriptC runtime image |
| `Containerfile.poc-node` | Node twin (same entry) |
| `Containerfile` / `compare.sh` | Fixture binary-vs-Node deploy size compare |
| `Containerfile.toolchain` | clang 18 + cmake + scriptc for coverage |
| `benchmark.sh` | README-style metrics (size, startup, RSS, latency) |
| `coverage-inventory.sh` | Host entry for the coverage ladder |
| `out-image/`, `out-bench/`, `out-coverage/` | Generated reports (wipeable) |

Yarn: `packages/backend-scriptc` is **excluded** from workspaces (`!packages/backend-scriptc` in the root `package.json`) so Konflux/hermeto do not pull `scriptc` into the Hub image build.

Root scripts:

```bash
yarn prototype:scriptc           # fixture size compare (binary vs Node deploy)
yarn prototype:scriptc:image     # build + smoke ScriptC and Node images
yarn prototype:scriptc:bench     # size + startup + RSS + /healthcheck latency
yarn prototype:scriptc:coverage  # coverage ladder + READINESS / triage
```

Useful env vars for coverage:

- `HEARTBEAT_SECS=10` (default 5) — progress while `scriptc coverage` runs (scriptc has no native progress UI)
- `SKIP_COMPLETED=1` — resume without wiping existing `*.coverage.txt` files

Platform note: primary scriptc platform is macOS arm64. HTTP servers and `--dynamic` need Linux or macOS. On this Windows workstation we build and run **Linux** images with Podman. A Mac is not required for the container PoC.

---

## Trimmed PoC (what actually runs)

Shared entry: `src/main.ts`

- Listens on `0.0.0.0:$PORT` (default 7007)
- `GET /healthcheck` and `GET /.backstage/health/v1/liveness`
- `GET /api/poc/info?echo=…` (zod-validated query)
- Uses npm `zod` → scriptc build uses `--dynamic` (embedded quickjs-ng island for that dependency)

Images:

| Tag | Base | Entrypoint |
|---|---|---|
| `rhdh-backend-scriptc-poc:local` | `debian:bookworm-slim` | `/usr/local/bin/rhdh-poc` |
| `rhdh-backend-scriptc-poc-node:local` | `node:24-bookworm-slim` | `node main.js` |

Run:

```bash
podman run --rm -p 7007:7007 rhdh-backend-scriptc-poc:local
podman run --rm -p 7007:7007 rhdh-backend-scriptc-poc-node:local
```

Smoke JSON (both healthy):

```json
{"service":"rhdh-backend-scriptc","runtime":"/usr/local/bin/rhdh-poc","echo":"hi","note":"trimmed PoC — packages/backend-scriptc, not packages/backend"}
```

---

## Image size

Source: `out-image/image-size-report.txt` (from `yarn prototype:scriptc:image`).

| | ScriptC | Node twin |
|---|---:|---:|
| Image tag | `rhdh-backend-scriptc-poc:local` | `rhdh-backend-scriptc-poc-node:local` |
| Image size | **86 MB** (89,198,533 bytes) | **228 MB** (238,508,711 bytes) |
| Node / ScriptC | | **~2.67×** |

Same `src/main.ts` in both images. This is not the full Hub image.

---

## README-style benchmark

scriptc’s README calls out startup, binary size, memory (RSS), and runtime. We measured those for the trimmed PoC in containers (`yarn prototype:scriptc:bench`, report in `out-bench/bench-report.txt`).

| Metric | ScriptC | Node | Node / ScriptC |
|---|---:|---:|---:|
| Image size | 86 MB | 228 MB | 2.67× |
| Payload on disk | 1.7 MB (binary) | 3.6 MB (`/app` tree) | 2.17× |
| Startup → first healthy `/healthcheck` | 225.2 ms | 256.9 ms | 1.14× |
| RSS (`VmRSS` of PID 1) | **6.0 MB** | **62.4 MB** | **10.42×** |
| cgroup mem (`podman stats`) | 2.8 MB | 16.8 MB | 6.05× |
| Avg `/healthcheck` latency (50 reqs after warmup) | 1.9 ms | 2.0 ms | ~1× |

Caveats:

- Startup includes container start. It will not match the README’s process-only ~2 ms vs ~47 ms.
- Latency is a light healthcheck proxy, not scriptc’s CPU microbenchmarks.
- RSS is the clearest win on this PoC.

How metrics were taken:

- Image size: `podman image inspect` `.Size`
- Payload: `wc -c` on the ScriptC binary, or `du -sb /app` for Node
- Startup: time from `podman run -d` until first successful curl to `/healthcheck`
- RSS: `VmRSS` from `/proc/1/status` inside the container (ENTRYPOINT is PID 1)
- Latency: average curl `time_total` over 50 requests after 10 warmup requests

---

## Coverage ladder (toward full backend)

Command: `yarn prototype:scriptc:coverage`
Toolchain: clang 18, cmake, `scriptc@0.0.23` in `rhdh-backend-scriptc-toolchain:local`
Mode: `scriptc coverage <file> --dynamic`
Host quirk: Yarn workspace symlinks that point at `/mnt/c/...` are dead inside Podman; the harness relinks `@internal/*`, `app`, `backend`, etc. to `/work/...` before coverage.

### Results (wall clock in the container)

| # | Entry | Result | Time |
|---|---|---|---:|
| 01 | `src/main.ts` (trimmed) | OK — builds with `--dynamic` | 3s |
| 02 | `createBackend()` only | OK — 100% dynamic island | 579s |
| 03 | + RHDH healthcheck plugin | OK | 544s |
| 04 | Core static plugins, **no** dynamic loader | OK | 754s |
| 05 | + `dynamicPluginsFeatureLoader` | **Blocker SC1090** | 622s |
| 99 | Full `packages/backend/src/index.ts` | **Blockers SC1090, SC2001, SC2004, SC2009, SC2020** | 1117s |

Triage summary (`out-coverage/triage.txt`):

| Label | Status | Static | Dynamic | SC codes |
|---|---|---:|---:|---|
| 01-main-trimmed | OK | 38 (90%) | 4 (9%) | (none) |
| 02-create-backend-empty | OK | 0 (0%) | 2 (100%) | (none) |
| 03-create-backend-health | OK | 0 (0%) | 8 (100%) | (none) |
| 04-core-static-plugins | OK | 0 (0%) | 16 (100%) | (none) |
| 05-with-dynamic-plugins | HAS_FINDINGS | 1 (8%) | 10 (83%) | SC1090 |
| 99-full-backend-index | HAS_FINDINGS | 48 (29%) | 69 (42%) | SC1090, SC2001, SC2004, SC2009, SC2020 |

### What the rungs contain

**01 — trimmed** (`src/main.ts`): plain `http` + zod. Mostly static; zod forces `--dynamic`.

**02 — empty backend** (`src/entries/02-create-backend-empty.ts`): only `createBackend()` + `start()`. Tiny source file; coverage still walks `@backstage/backend-defaults` and a large npm graph (knex, sqlite drivers, redis, aws/azure/gcp clients, etc.) as shims or “lazy traps” for optional `require()`s.

**03 — health** (`03-create-backend-health.ts`): 02 plus relative import of `packages/backend/src/modules/healthcheck.ts`.

**04 — core static plugins** (`04-core-static-plugins.ts`): health + app, catalog, proxy, auth, guest provider, search, search-catalog, permission. No `dynamicPluginsFeatureLoader`. Coverage says it builds with `--dynamic`.

**05 — dynamic plugins** (`05-with-dynamic-plugins.ts`): adds `dynamicPluginsFeatureLoader` + `CommonJSModuleLoader` + `PackageRoles` schema locator pattern from the real backend. Fails coverage with:

- **SC1090** — reading `role` from a Backstage package-role typed value (optional / structural typing edge).

**99 — full index** (`packages/backend/src/index.ts`): real Hub entry. Additional blockers include SC2001, SC2004, SC2009, SC2020 (language / stdlib lowering gaps; some noted as unreached). Still not a clean `--dynamic` build.

### Important distinction

“Builds with `--dynamic`” on rungs 02–04 is a **coverage** claim. We have not yet produced and smoke-tested a ScriptC binary for `createBackend()` or the static plugin set. The trimmed `main.ts` image is the only runtime-proven binary so far.

---

## Dynamic plugins: why “no”

1. **Coverage fails** on the dynamic-plugins rung (SC1090) and on the full backend index (several SC codes).
2. **Runtime model mismatch:** RHDH loads plugins from disk with CommonJS (`CommonJSModuleLoader`, filesystem scan, optional OCI install). ScriptC embeds dependency JS at **build** time; binaries do not read `node_modules` at runtime.
3. Fixing (1) alone would not give true “drop a plugin on disk and load it.” That needs a different design, for example:
   - Prebundle known plugins into the binary at build time, or
   - Keep a small Node/host process for dynamic loading, or
   - Some other explicit external-host integration.

`out-coverage/READINESS.txt` verdict: **NO** for a full-on PoC with dynamic plugins.

---

## Tooling notes from the investigation

- Bookworm’s default clang 14 is too old for scriptc’s LLVM IR; the toolchain image uses **clang 18**. Builds use `--backend c` for broader clang compatibility.
- `--dynamic` needs **cmake** (embeds quickjs-ng).
- Coverage with no output for minutes usually means typechecking a large import graph; the harness heartbeats every N seconds and shows stdout/stderr byte counts.
- An earlier hang after scriptc printed its report came from `tee` + process substitution + `wait`; the harness now writes to files and heartbeats in a separate loop so the process exits cleanly.
- Do not wipe `*.coverage.txt` when using `SKIP_COMPLETED=1` (the inventory script preserves them in that mode).

---

## Where that leaves us

| Goal | Status |
|---|---|
| Linux ScriptC container on Windows | Done (trimmed app) |
| Fair Node twin + image size | Done (~2.7×) |
| RSS / startup / latency bench | Done (RSS ~10×) |
| Coverage of `createBackend` / static plugins | Coverage-green for 02–04 |
| Coverage of dynamic plugins / full index | Failed (SC blockers) |
| Runtime binary for Backstage `createBackend` | Not done yet |
| Full Hub + dynamic plugins | Out of scope for current scriptc model |

**Recommended next compile target:** build and image-twin `src/entries/04-core-static-plugins.ts` (coverage already says `--dynamic` is clean). Keep true dynamic plugins as a separate design spike.

---

## Artifact index

| Path | Contents |
|---|---|
| `out-image/image-size-report.txt` | Image size comparison |
| `out-image/image-size-report.json` | Same, machine-readable |
| `out-bench/bench-report.txt` | Size, startup, RSS, latency |
| `out-bench/bench-report.json` | Same, machine-readable |
| `out-coverage/ladder-summary.tsv` | Exit codes and seconds per rung |
| `out-coverage/triage.txt` | Per-rung static/dynamic % and SC codes |
| `out-coverage/READINESS.txt` | Dynamic-plugins readiness verdict |
| `out-coverage/*-*.coverage.txt` | Full scriptc coverage dumps |

Generated dirs are gitignored. Re-run the yarn scripts above to refresh them.
