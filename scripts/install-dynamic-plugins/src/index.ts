import { accessSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { cleanupCatalogIndexTemp, extractCatalogIndex } from './catalog-index.js';
import { getWorkers, mapConcurrent } from './concurrency.js';
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

  // Optional catalog index extraction — surfaces `dynamic-plugins.default.yaml`.
  const catalogImage = process.env.CATALOG_INDEX_IMAGE ?? '';
  let catalogDpdy: string | null = null;
  if (catalogImage) {
    const entitiesDir =
      process.env.CATALOG_ENTITIES_EXTRACT_DIR ?? path.join(os.tmpdir(), 'extensions');
    catalogDpdy = await extractCatalogIndex(skopeo, catalogImage, root, entitiesDir);
  }

  const skipIntegrity = (process.env.SKIP_INTEGRITY_CHECK ?? '').toLowerCase() === 'true';

  const globalConfigFile = path.join(root, GLOBAL_CONFIG_FILENAME);
  if (!(await fileExists(CONFIG_FILE))) {
    log(`No ${CONFIG_FILE} found. Skipping.`);
    await fs.writeFile(globalConfigFile, '');
    return 0;
  }

  const rawContent = await fs.readFile(CONFIG_FILE, 'utf8');
  const content = parseYaml(rawContent) as DynamicPluginsConfig | null;
  if (!content) {
    log(`${CONFIG_FILE} is empty. Skipping.`);
    await fs.writeFile(globalConfigFile, '');
    return 0;
  }

  const imageCache = new OciImageCache(
    skopeo,
    await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-oci-cache-')),
  );

  const allPlugins: PluginMap = {};
  const includes = [...(content.includes ?? [])];

  // Substitute the placeholder DPDY include with the extracted catalog-index file.
  if (catalogDpdy) {
    const idx = includes.indexOf(DPDY_FILENAME);
    if (idx !== -1) includes[idx] = catalogDpdy;
  }

  for (const inc of includes) {
    if (!(await fileExists(inc))) {
      log(`WARNING: include file ${inc} not found, skipping`);
      continue;
    }
    log(`\n======= Including plugins from ${inc}`);
    await mergePluginsFromFile(inc, allPlugins, /* level */ 0, imageCache);
  }

  for (const plugin of content.plugins ?? []) {
    await mergePlugin(plugin, allPlugins, CONFIG_FILE, /* level */ 1, imageCache);
  }

  for (const p of Object.values(allPlugins)) {
    p.plugin_hash = computePluginHash(p);
  }

  const installed = await readInstalledPluginHashes(root);

  const globalConfig: Record<string, unknown> = {
    dynamicPlugins: { rootDirectory: 'dynamic-plugins-root' },
  };

  const { oci, npm, skipped } = categorize(allPlugins);
  handleSkippedLocals(skipped, globalConfig);

  const errors: string[] = [];
  await installOci(oci, root, imageCache, installed, workers, globalConfig, errors);
  await installNpm(npm, root, skipIntegrity, installed, globalConfig, errors);

  await fs.writeFile(globalConfigFile, stringifyYaml(globalConfig));

  await cleanupRemoved(root, installed);

  if (errors.length > 0) {
    log(`\n======= ${errors.length} plugin(s) failed:`);
    for (const err of errors) log(`  - ${err}`);
    return 1;
  }

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
  log(
    `\n======= Installing ${plugins.length} OCI plugin(s) (${workers} worker${workers === 1 ? '' : 's'})`,
  );

  const results = await mapConcurrent(plugins, workers, async plugin => {
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

async function installNpm(
  plugins: Plugin[],
  root: string,
  skipIntegrity: boolean,
  installed: Map<string, string>,
  globalConfig: Record<string, unknown>,
  errors: string[],
): Promise<void> {
  if (plugins.length === 0) return;
  log(`\n======= Installing ${plugins.length} NPM plugin(s) (sequential)`);
  for (const plugin of plugins) {
    log(`\n======= Installing NPM plugin ${plugin.package}`);
    try {
      const result = await installNpmPlugin(plugin, root, skipIntegrity, installed);
      if (isPlainObject(result.pluginConfig)) {
        deepMerge(result.pluginConfig, globalConfig);
      }
      if (result.pluginPath) log(`\t==> Installed ${plugin.package}`);
    } catch (err) {
      errors.push(`${plugin.package}: ${(err as Error).message}`);
      log(`\t==> ERROR: ${plugin.package}: ${(err as Error).message}`);
    }
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

main().catch((err: unknown) => {
  const msg = err instanceof InstallException ? err.message : String(err);
  process.stderr.write(`\ninstall-dynamic-plugins failed: ${msg}\n`);
  process.exit(1);
});
