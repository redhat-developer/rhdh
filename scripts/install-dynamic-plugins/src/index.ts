import { accessSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { cleanupCatalogIndexTemp, extractCatalogIndex } from './catalog-index.js';
import { getNpmWorkers, getWorkers, mapConcurrent } from './concurrency.js';
import { InstallException } from './errors.js';
import { OciImageCache } from './image-cache.js';
import { installNpmPlugin } from './installer-npm.js';
import { installOciPlugin } from './installer-oci.js';
import { createLock, registerLockCleanup, removeLock } from './lock-file.js';
import { log } from './log.js';
import { deepMerge, mergePlugin, mergePluginsFromFile } from './merger.js';
import { computePluginHash } from './plugin-hash.js';
import { Skopeo } from './skopeo.js';
import {
  CONFIG_HASH_FILE,
  DPDY_FILENAME,
  type DynamicPluginsConfig,
  GLOBAL_CONFIG_FILENAME,
  LOCK_FILENAME,
  OCI_PROTO,
  type Plugin,
  type PluginMap,
} from './types.js';
import { fileExists, isPlainObject } from './util.js';

const CONFIG_FILE = 'dynamic-plugins.yaml';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    process.stderr.write(`Usage: install-dynamic-plugins <dynamic-plugins-root>\n`);
    process.exit(1);
  }
  const root = path.resolve(argv[0] as string);
  const lockPath = path.join(root, LOCK_FILENAME);
  registerLockCleanup(lockPath);
  await fs.mkdir(root, { recursive: true });
  await createLock(lockPath);

  let exitCode = 0;
  try {
    exitCode = await runInstaller(root);
  } finally {
    await cleanupCatalogIndexTemp(root).catch(() => undefined);
    await removeLock(lockPath).catch(() => undefined);
  }
  process.exit(exitCode);
}

async function runInstaller(root: string): Promise<number> {
  const skopeo = new Skopeo();
  const workers = getWorkers();
  log(`======= Workers: ${workers} (CPUs: ${os.cpus().length})`);

  // Resolve the config file path against CWD at startup so the dependency on
  // CWD is explicit in the operator log; includes are resolved relative to
  // the config file's directory (matches the Python installer).
  const configFileAbs = path.resolve(CONFIG_FILE);
  const configDir = path.dirname(configFileAbs);
  const globalConfigFile = path.join(root, GLOBAL_CONFIG_FILENAME);
  log(`======= Config file: ${configFileAbs}`);

  const catalogDpdy = await maybeExtractCatalogIndex(skopeo, root);
  const content = await loadDynamicPluginsConfig(configFileAbs, globalConfigFile);
  if (!content) return 0;

  const imageCache = new OciImageCache(
    skopeo,
    await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-oci-cache-')),
  );

  const allPlugins = await loadAllPlugins(content, configFileAbs, configDir, catalogDpdy, imageCache);
  const installed = await readInstalledPluginHashes(root);
  const globalConfig: Record<string, unknown> = {
    dynamicPlugins: { rootDirectory: 'dynamic-plugins-root' },
  };
  const { oci, npm, skipped } = categorize(allPlugins);
  handleSkippedLocals(skipped, globalConfig);

  const skipIntegrity = (process.env.SKIP_INTEGRITY_CHECK ?? '').toLowerCase() === 'true';
  const errors: string[] = [];
  await installOci(oci, root, imageCache, installed, workers, globalConfig, errors);
  await installNpm(npm, root, skipIntegrity, installed, globalConfig, errors);

  return finalizeInstall(errors, globalConfigFile, globalConfig, root, installed);
}

/** Optional `CATALOG_INDEX_IMAGE` extraction — returns the path to the
 * extracted `dynamic-plugins.default.yaml`, or `null` when the env var is
 * unset. */
async function maybeExtractCatalogIndex(skopeo: Skopeo, root: string): Promise<string | null> {
  const catalogImage = process.env.CATALOG_INDEX_IMAGE ?? '';
  if (!catalogImage) return null;
  const entitiesDir =
    process.env.CATALOG_ENTITIES_EXTRACT_DIR ?? path.join(os.tmpdir(), 'extensions');
  return extractCatalogIndex(skopeo, catalogImage, root, entitiesDir);
}

/** Read and parse `dynamic-plugins.yaml`. Writes an empty global config and
 * returns `null` for the two short-circuit cases (file missing, file empty)
 * so the caller can early-exit with code 0. */
async function loadDynamicPluginsConfig(
  configFileAbs: string,
  globalConfigFile: string,
): Promise<DynamicPluginsConfig | null> {
  if (!(await fileExists(configFileAbs))) {
    log(`No ${CONFIG_FILE} found at ${configFileAbs}. Skipping.`);
    await fs.writeFile(globalConfigFile, '');
    return null;
  }
  const rawContent = await fs.readFile(configFileAbs, 'utf8');
  const content = parseYaml(rawContent) as DynamicPluginsConfig | null;
  if (!content) {
    log(`${configFileAbs} is empty. Skipping.`);
    await fs.writeFile(globalConfigFile, '');
    return null;
  }
  return content;
}

/** Resolve include paths, substitute the catalog-index placeholder, merge
 * everything into a single `PluginMap`, and compute change-detection hashes. */
async function loadAllPlugins(
  content: DynamicPluginsConfig,
  configFileAbs: string,
  configDir: string,
  catalogDpdy: string | null,
  imageCache: OciImageCache,
): Promise<PluginMap> {
  const allPlugins: PluginMap = {};
  const includes = resolveIncludes(content.includes ?? [], configDir, catalogDpdy);

  for (const inc of includes) {
    if (!(await fileExists(inc))) {
      log(`WARNING: include file ${inc} not found, skipping`);
      continue;
    }
    log(`\n======= Including plugins from ${inc}`);
    await mergePluginsFromFile(inc, allPlugins, /* level */ 0, imageCache);
  }

  for (const plugin of content.plugins ?? []) {
    await mergePlugin(plugin, allPlugins, configFileAbs, /* level */ 1, imageCache);
  }

  for (const p of Object.values(allPlugins)) {
    p.plugin_hash = computePluginHash(p);
  }
  return allPlugins;
}

function resolveIncludes(
  rawIncludes: readonly string[],
  configDir: string,
  catalogDpdy: string | null,
): string[] {
  const includes = rawIncludes.map(inc =>
    path.isAbsolute(inc) ? inc : path.resolve(configDir, inc),
  );
  if (catalogDpdy) {
    const idx = includes.findIndex(inc => path.basename(inc) === DPDY_FILENAME);
    if (idx !== -1) includes[idx] = catalogDpdy;
  }
  return includes;
}

export async function finalizeInstall(
  errors: string[],
  globalConfigFile: string,
  globalConfig: Record<string, unknown>,
  root: string,
  installed: Map<string, string>,
): Promise<number> {
  if (errors.length > 0) {
    log(`\n======= ${errors.length} plugin(s) failed:`);
    for (const err of errors) log(`  - ${err}`);
    // Skip writing the global config and cleaning up previously-installed
    // plugin dirs so the filesystem does not end up in an "almost valid"
    // state. Exit 1 is enough for init containers to block startup, but a
    // manual restart of the main container (or a deployment that does not
    // enforce init-container success) could otherwise pick up a partial
    // config — e.g. a frontend plugin without its backend dep, yielding a
    // broken UI. Preserving the prior state makes the next run a clean retry.
    log(
      `\n======= Skipping ${GLOBAL_CONFIG_FILENAME} write and cleanup because of install failures. ` +
        `Fix the errors above and re-run; the previous successful state is preserved.`,
    );
    return 1;
  }

  await fs.writeFile(globalConfigFile, stringifyYaml(globalConfig));
  await cleanupRemoved(root, installed);

  log('\n======= All plugins installed successfully');
  return 0;
}

type Categorized = {
  oci: Plugin[];
  npm: Plugin[];
  skipped: Plugin[];
};

function categorize(allPlugins: PluginMap): Categorized {
  const oci: Plugin[] = [];
  const npm: Plugin[] = [];
  const skipped: Plugin[] = [];
  for (const plugin of Object.values(allPlugins)) {
    if (plugin.disabled) {
      log(`\n======= Skipping disabled plugin ${plugin.package}`);
      continue;
    }
    if (plugin.package.startsWith(OCI_PROTO)) {
      oci.push(plugin);
      continue;
    }
    if (plugin.package.startsWith('./')) {
      const localPath = path.join(process.cwd(), plugin.package.slice(2));
      if (existsSyncSafe(localPath)) npm.push(plugin);
      else skipped.push(plugin);
      continue;
    }
    npm.push(plugin);
  }
  return { oci, npm, skipped };
}

function handleSkippedLocals(skipped: Plugin[], globalConfig: Record<string, unknown>): void {
  if (skipped.length === 0) return;
  log(`\n======= Skipping ${skipped.length} local plugins (directories not found)`);
  for (const plugin of skipped) {
    const abs = path.join(process.cwd(), plugin.package.slice(2));
    log(`\t==> ${plugin.package} (not found at ${abs})`);
    if (isPlainObject(plugin.pluginConfig)) {
      deepMerge(plugin.pluginConfig, globalConfig);
    }
  }
}

async function installOci(
  plugins: Plugin[],
  root: string,
  imageCache: OciImageCache,
  installed: Map<string, string>,
  workers: number,
  globalConfig: Record<string, unknown>,
  errors: string[],
): Promise<void> {
  if (plugins.length === 0) return;

  // Fast pre-pass: short-circuit plugins that are definitely a no-op (already
  // installed, IF_NOT_PRESENT pull policy, no force) without going through the
  // worker-pool / Promise machinery. Avoids 6-way parallel skopeo invocations
  // for the common steady-state restart case.
  const needsWork: Plugin[] = [];
  for (const plugin of plugins) {
    if (definitelyNoOp(plugin, installed)) {
      log(`\t==> ${plugin.package}: already installed, skipping`);
      installed.delete(plugin.plugin_hash as string);
      if (isPlainObject(plugin.pluginConfig)) {
        try {
          deepMerge(plugin.pluginConfig, globalConfig);
        } catch (err) {
          errors.push(`${plugin.package}: ${(err as Error).message}`);
        }
      }
    } else {
      needsWork.push(plugin);
    }
  }

  if (needsWork.length === 0) return;
  log(
    `\n======= Installing ${needsWork.length} OCI plugin(s) (${workers} worker${workers === 1 ? '' : 's'})`,
  );

  const results = await mapConcurrent(needsWork, workers, async plugin => {
    log(`\n======= Installing OCI plugin ${plugin.package}`);
    return installOciPlugin(plugin, root, imageCache, installed);
  });

  for (const outcome of results) {
    if (!outcome.ok) {
      errors.push(`${outcome.item.package}: ${outcome.error.message}`);
      log(`\t==> ERROR: ${outcome.item.package}: ${outcome.error.message}`);
      continue;
    }
    const { value, item } = outcome;
    if (isPlainObject(value.pluginConfig)) {
      try {
        deepMerge(value.pluginConfig, globalConfig);
      } catch (err) {
        errors.push(`${item.package}: ${(err as Error).message}`);
        continue;
      }
    }
    if (value.pluginPath) log(`\t==> Installed ${item.package}`);
  }
}

/**
 * Cheap synchronous check: a plugin is "definitely" a no-op when its hash is
 * already on disk, the user did not force a re-download, and the pull policy
 * doesn't demand a remote-digest comparison. ALWAYS-pull plugins still go
 * through the regular install path because they need a `skopeo inspect` to
 * compare local vs remote digest.
 */
function definitelyNoOp(plugin: Plugin, installed: Map<string, string>): boolean {
  if (!plugin.plugin_hash || !installed.has(plugin.plugin_hash)) return false;
  if (plugin.forceDownload) return false;
  const isLatest = plugin.package.includes(':latest!');
  const pullPolicy = plugin.pullPolicy ?? (isLatest ? 'Always' : 'IfNotPresent');
  return pullPolicy !== 'Always';
}

async function installNpm(
  plugins: Plugin[],
  root: string,
  skipIntegrity: boolean,
  installed: Map<string, string>,
  globalConfig: Record<string, unknown>,
  errors: string[],
): Promise<void> {
  if (plugins.length === 0) return;

  // Same fast pre-pass as installOci: skip the worker pool for hash-matched
  // plugins that don't need any IO.
  const needsWork: Plugin[] = [];
  for (const plugin of plugins) {
    if (definitelyNoOp(plugin, installed)) {
      log(`\t==> ${plugin.package}: already installed, skipping`);
      installed.delete(plugin.plugin_hash as string);
      if (isPlainObject(plugin.pluginConfig)) {
        try {
          deepMerge(plugin.pluginConfig, globalConfig);
        } catch (err) {
          errors.push(`${plugin.package}: ${(err as Error).message}`);
        }
      }
    } else {
      needsWork.push(plugin);
    }
  }

  if (needsWork.length === 0) return;
  const workers = getNpmWorkers();
  log(
    `\n======= Installing ${needsWork.length} NPM plugin(s) (${workers} worker${workers === 1 ? '' : 's'})`,
  );

  // `npm pack` writes the tarball to `cwd` with a package-derived filename
  // (`<name>-<version>.tgz`), so concurrent invocations against different
  // packages don't clash on the filename. The npm CLI cache (~/.npm/_cacache)
  // handles its own locking. Cap defaults to 3 to keep the registry happy —
  // override with `DYNAMIC_PLUGINS_NPM_WORKERS=1` to restore the original
  // sequential behaviour.
  const results = await mapConcurrent(needsWork, workers, async plugin => {
    log(`\n======= Installing NPM plugin ${plugin.package}`);
    return installNpmPlugin(plugin, root, skipIntegrity, installed);
  });

  for (const outcome of results) {
    if (!outcome.ok) {
      errors.push(`${outcome.item.package}: ${outcome.error.message}`);
      log(`\t==> ERROR: ${outcome.item.package}: ${outcome.error.message}`);
      continue;
    }
    const { value, item } = outcome;
    if (isPlainObject(value.pluginConfig)) {
      try {
        deepMerge(value.pluginConfig, globalConfig);
      } catch (err) {
        errors.push(`${item.package}: ${(err as Error).message}`);
        continue;
      }
    }
    if (value.pluginPath) log(`\t==> Installed ${item.package}`);
  }
}

async function cleanupRemoved(root: string, installed: Map<string, string>): Promise<void> {
  for (const [, dir] of installed) {
    const pluginDir = path.join(root, dir);
    log(`\n======= Removing obsolete plugin ${dir}`);
    await fs.rm(pluginDir, { recursive: true, force: true });
  }
}

async function readInstalledPluginHashes(root: string): Promise<Map<string, string>> {
  const installed = new Map<string, string>();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return installed;
  }
  for (const entry of entries) {
    const hashFile = path.join(root, entry, CONFIG_HASH_FILE);
    try {
      const hash = (await fs.readFile(hashFile, 'utf8')).trim();
      if (hash) installed.set(hash, entry);
    } catch {
      /* not a plugin dir */
    }
  }
  return installed;
}

function existsSyncSafe(filePath: string): boolean {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// Only run main() when invoked directly (CLI or esbuild's CJS bundle entry),
// not when imported for tests. Under ts-jest the source is transpiled to CJS,
// so `require.main === module` is the reliable signal.
if (require.main === module) {
  main().catch((err: unknown) => {
    const msg = err instanceof InstallException ? err.message : String(err);
    process.stderr.write(`\ninstall-dynamic-plugins failed: ${msg}\n`);
    process.exit(1);
  });
}
