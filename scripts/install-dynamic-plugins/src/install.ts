/**
 * Dynamic plugin installation orchestration (ported from install-dynamic-plugins.sh).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join as pathJoin } from 'node:path';
import lockfile from 'proper-lockfile';
import { stringify as yamlStringify } from 'yaml';
import { computePluginHashFromObject } from './compute-plugin-hash.js';
import { mergeAppConfigFragments } from './merge-app-config.js';
import { mergeDynamicPlugins } from './merge-dynamic-plugins.js';
import { ociCopyImageLayer0, ociImageDigestHex } from './registry-oci.js';

const MAX_ENTRY_SIZE = Number(process.env.MAX_ENTRY_SIZE || '20000000');
const SKIP_INTEGRITY_CHECK = process.env.SKIP_INTEGRITY_CHECK || '';
const CATALOG_INDEX_IMAGE = process.env.CATALOG_INDEX_IMAGE || '';
const CATALOG_ENTITIES_EXTRACT_DIR = process.env.CATALOG_ENTITIES_EXTRACT_DIR || '';

export function die(msg: string): never {
  console.error(`install-dynamic-plugins: ${msg}`);
  process.exit(1);
}

let ociTmp = '';
const ociTarCache = new Map<string, string>();

function needCmd(name: string): void {
  try {
    execFileSync('sh', ['-c', 'command -v "$1"', 'sh', name], {
      stdio: 'ignore'
    });
  } catch {
    die(`required command not found: ${name}`);
  }
}

function extractNpmTgz(archive: string, destDir: string): void {
  const list = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const first = list[0];
  if (!first?.startsWith('package/')) {
    die(`NPM package archive does not start with 'package/' as it should: ${first}`);
  }
  mkdirSync(destDir, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', destDir, '--strip-components=1']);
}

function verifyIntegrity(pkgJson: Record<string, unknown>, archive: string): void {
  const integ = pkgJson.integrity as string | undefined;
  if (!integ) {
    die('Package integrity missing');
  }
  const algo = integ.split('-')[0]!;
  const b64 = integ.slice(integ.indexOf('-') + 1);
  if (!['sha512', 'sha384', 'sha256'].includes(algo)) {
    die(`unsupported integrity algorithm ${algo}`);
  }
  try {
    Buffer.from(b64, 'base64');
  } catch {
    die('integrity hash is not valid base64');
  }
  const buf = readFileSync(archive);
  const gotOpenssl = execFileSync('openssl', ['base64', '-A'], {
    input: execFileSync('openssl', ['dgst', `-${algo}`, '-binary'], { input: buf })
  })
    .toString('utf8')
    .replace(/\n/g, '');
  if (gotOpenssl !== b64) {
    die(`integrity hash mismatch for ${String(pkgJson.package)}`);
  }
}

function getLocalPackageInfo(packagePath: string): Record<string, unknown> {
  const abs = pathJoin(process.cwd(), packagePath.replace(/^\.\//, ''));
  if (!existsSync(`${abs}/package.json`)) {
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      const mt = Math.floor(statSync(abs).mtimeMs / 1000);
      return { _directory_mtime: mt };
    }
    return { _not_found: true };
  }
  let pj: Record<string, unknown>;
  try {
    pj = JSON.parse(readFileSync(`${abs}/package.json`, 'utf8')) as Record<string, unknown>;
  } catch {
    pj = {};
  }
  const m = Math.floor(statSync(`${abs}/package.json`).mtimeMs / 1000);
  let out: Record<string, unknown> = { _package_json: pj, _package_json_mtime: m };
  if (existsSync(`${abs}/package-lock.json`)) {
    const lm = Math.floor(statSync(`${abs}/package-lock.json`).mtimeMs / 1000);
    out = { ...out, _package_lock_json_mtime: lm };
  }
  if (existsSync(`${abs}/yarn.lock`)) {
    const ym = Math.floor(statSync(`${abs}/yarn.lock`).mtimeMs / 1000);
    out = { ...out, _yarn_lock_mtime: ym };
  }
  return out;
}

function computePluginHash(p: Record<string, unknown>): string {
  const pkg = String(p.package);
  const base: Record<string, unknown> = { ...p };
  delete base.pluginConfig;
  delete base.version;
  delete base.plugin_hash;
  if (pkg.startsWith('./')) {
    const info = getLocalPackageInfo(pkg);
    return computePluginHashFromObject({ ...base, _local_package_info: info });
  }
  return computePluginHashFromObject(base);
}

function maybeMergeConfig(
  frag: string,
  globalJson: Record<string, unknown>
): Record<string, unknown> {
  if (!frag || frag === '{}' || frag === 'null') {
    return globalJson;
  }
  console.error('\t==> Merging plugin-specific configuration');
  const fragObj = JSON.parse(frag) as Record<string, unknown>;
  mergeAppConfigFragments(fragObj, globalJson);
  return globalJson;
}

async function extractCatalogIndex(
  catalogImage: string,
  mountRoot: string,
  entitiesParent: string
): Promise<string> {
  console.error(`\n======= Extracting catalog index from ${catalogImage}`);
  const tmp = await mkdtemp(pathJoin(tmpdir(), 'cat-idx-'));
  try {
    await ociCopyImageLayer0(catalogImage, pathJoin(tmp, 'oci'));
    const manifestPath = pathJoin(tmp, 'oci', 'manifest.json');
    if (!existsSync(manifestPath)) {
      die('manifest.json not found in catalog index image');
    }
    const catalogTemp = pathJoin(mountRoot, '.catalog-index-temp');
    mkdirSync(catalogTemp, { recursive: true });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      layers?: Array<{ digest?: string }>;
    };
    console.error('\t==> Extracting catalog index layers');
    const layers = (manifest.layers || [])
      .map(l => l.digest)
      .filter(Boolean) as string[];
    for (const layer of layers) {
      const fn = layer.includes(':') ? layer.split(':')[1]! : layer;
      const layerPath = pathJoin(tmp, 'oci', fn);
      if (!existsSync(layerPath)) {
        continue;
      }
      console.error(`\t==> Extracting layer ${fn}`);
      try {
        const tv = execFileSync('tar', ['-tvf', layerPath], {
          encoding: 'utf8',
          maxBuffer: 50 * 1024 * 1024
        });
        for (const line of tv.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 2) {
            continue;
          }
          const sz = parts[2];
          const pth = parts[parts.length - 1];
          if (!/^\d+$/.test(sz || '')) {
            continue;
          }
          if (Number(sz) > MAX_ENTRY_SIZE) {
            console.error(`\t==> WARNING: Skipping large file ${pth} in catalog index`);
          }
        }
      } catch {
        /* ignore */
      }
      try {
        execFileSync('tar', ['-xf', layerPath, '-C', catalogTemp]);
      } catch {
        /* ignore */
      }
    }
    const defaultYaml = pathJoin(catalogTemp, 'dynamic-plugins.default.yaml');
    if (!existsSync(defaultYaml)) {
      die('Catalog index image does not contain dynamic-plugins.default.yaml');
    }
    console.error(
      '\t==> Successfully extracted dynamic-plugins.default.yaml from catalog index image'
    );
    console.error(`\t==> Extracting extensions catalog entities to ${entitiesParent}`);
    mkdirSync(entitiesParent, { recursive: true });
    const extdir = pathJoin(catalogTemp, 'catalog-entities', 'extensions');
    const mktdir = pathJoin(catalogTemp, 'catalog-entities', 'marketplace');
    let src = '';
    if (existsSync(extdir) && statSync(extdir).isDirectory()) {
      src = extdir;
    } else if (existsSync(mktdir) && statSync(mktdir).isDirectory()) {
      src = mktdir;
    }
    if (src) {
      const dest = pathJoin(entitiesParent, 'catalog-entities');
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      execFileSync('cp', ['-a', `${src}/.`, `${dest}/`]);
      console.error('\t==> Successfully extracted extensions catalog entities from index image');
    } else {
      console.error(
        `\t==> WARNING: Catalog index image does not have neither 'catalog-entities/extensions/' nor 'catalog-entities/marketplace/' directory`
      );
    }
    return defaultYaml;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function cleanupCatalog(root: string): void {
  const p = pathJoin(root, '.catalog-index-temp');
  if (existsSync(p) && statSync(p).isDirectory()) {
    rmSync(p, { recursive: true, force: true });
    console.error('\n======= Cleaning up temporary catalog index directory');
  }
}

async function ociGetLayerTarball(image: string): Promise<string> {
  const key = createHash('sha256').update(image, 'utf8').digest('hex');
  const cached = ociTarCache.get(key);
  if (cached) {
    return cached;
  }
  const hdir = pathJoin(ociTmp, `oci-${key}`);
  mkdirSync(hdir, { recursive: true });
  await ociCopyImageLayer0(image, hdir);
  const mf = JSON.parse(readFileSync(pathJoin(hdir, 'manifest.json'), 'utf8')) as {
    layers?: Array<{ digest?: string }>;
  };
  const layer = mf.layers?.[0]?.digest;
  if (!layer) {
    die(`OCI image has no layers: ${image}`);
  }
  const hp = layer.includes(':') ? layer.split(':')[1]! : layer;
  const tarPath = pathJoin(hdir, hp);
  ociTarCache.set(key, tarPath);
  return tarPath;
}

async function shouldSkipOci(
  pluginJson: Record<string, unknown>,
  dest: string,
  pluginPathByHash: Map<string, string>
): Promise<'install' | 'skip'> {
  const ph = String(pluginJson.plugin_hash);
  const pkg = String(pluginJson.package);
  let policy: string;
  if (Object.prototype.hasOwnProperty.call(pluginJson, 'pullPolicy')) {
    policy = String(pluginJson.pullPolicy);
  } else {
    policy = pkg.includes(':latest!') ? 'Always' : 'IfNotPresent';
  }
  if (!pluginPathByHash.has(ph)) {
    return 'install';
  }
  if (policy === 'IfNotPresent') {
    return 'skip';
  }
  if (!pkg.includes('!')) {
    return 'install';
  }
  const path_ = pkg.split('!').slice(1).join('!');
  const digestFile = pathJoin(dest, path_, 'dynamic-plugin-image.hash');
  const img = pkg.split('!')[0]!;
  try {
    const remote = await ociImageDigestHex(img);
    if (existsSync(digestFile) && readFileSync(digestFile, 'utf8').trim() === remote) {
      return 'skip';
    }
  } catch {
    return 'install';
  }
  return 'install';
}

function shouldSkipNpm(
  pluginJson: Record<string, unknown>,
  pluginPathByHash: Map<string, string>
): 'install' | 'skip' {
  const ph = String(pluginJson.plugin_hash);
  if (!pluginPathByHash.has(ph)) {
    return 'install';
  }
  const policy = String(pluginJson.pullPolicy ?? 'IfNotPresent');
  const force = String(pluginJson.forceDownload ?? false);
  if (force === 'true') {
    return 'install';
  }
  if (policy === 'Always') {
    return 'install';
  }
  return 'skip';
}

async function installOnePlugin(
  dest: string,
  pluginJson: Record<string, unknown>,
  skipInt: boolean,
  pluginPathByHash: Map<string, string>
): Promise<string> {
  const pkg = String(pluginJson.package);
  const ph = String(pluginJson.plugin_hash);

  if (String(pluginJson.disabled) === 'true') {
    console.error(`\n======= Skipping disabled dynamic plugin ${pkg}`);
    return '{}';
  }

  let sk: 'install' | 'skip';
  if (pkg.startsWith('oci://')) {
    sk = await shouldSkipOci(pluginJson, dest, pluginPathByHash);
  } else {
    sk = shouldSkipNpm(pluginJson, pluginPathByHash);
  }
  if (sk === 'skip') {
    console.error(`\n======= Skipping download of already installed dynamic plugin ${pkg}`);
    pluginPathByHash.delete(ph);
    const pc = pluginJson.pluginConfig;
    return JSON.stringify(pc && typeof pc === 'object' ? pc : {});
  }

  console.error(`\n======= Installing dynamic plugin ${pkg}`);
  let pathOut: string;

  if (pkg.startsWith('oci://')) {
    const bang = pkg.indexOf('!');
    if (bang < 0) {
      die(`OCI package must resolve with !path: ${pkg}`);
    }
    const img = pkg.slice(0, bang);
    const pluginPath = pkg.slice(bang + 1);
    const tarb = await ociGetLayerTarball(img);
    const pdir = pathJoin(dest, pluginPath);
    if (existsSync(pdir)) {
      rmSync(pdir, { recursive: true, force: true });
    }
    mkdirSync(dest, { recursive: true });
    const members = execFileSync('tar', ['-tf', tarb], { encoding: 'utf8' })
      .split('\n')
      .filter(line => line.startsWith(pluginPath));
    if (members.length > 0) {
      execFileSync('tar', ['-xf', tarb, '-C', dest, ...members]);
    }
    const dg = await ociImageDigestHex(img);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(pathJoin(pdir, 'dynamic-plugin-image.hash'), dg, 'utf8');
    pathOut = pluginPath;
  } else {
    let packArg = pkg;
    if (packArg.startsWith('./')) {
      packArg = pathJoin(process.cwd(), packArg.replace(/^\.\//, ''));
    }
    if (!pkg.startsWith('./') && !skipInt && pluginJson.integrity === undefined) {
      die(`No integrity hash provided for Package ${pkg}`);
    }
    console.error('\t==> Grabbing package archive through `npm pack`');
    const archiveName = execFileSync('npm', ['pack', packArg], {
      cwd: dest,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop()!;
    const archive = pathJoin(dest, archiveName);
    if (!pkg.startsWith('./') && !skipInt) {
      console.error('\t==> Verifying package integrity');
      verifyIntegrity(pluginJson, archive);
    }
    const baseName = basename(archive, '.tgz');
    const extractTo = pathJoin(dest, baseName);
    if (existsSync(extractTo)) {
      rmSync(extractTo, { recursive: true, force: true });
    }
    mkdirSync(extractTo, { recursive: true });
    console.error(`\t==> Extracting package archive ${archive}`);
    extractNpmTgz(archive, extractTo);
    console.error(`\t==> Removing package archive ${archive}`);
    unlinkSync(archive);
    pathOut = baseName;
  }

  writeFileSync(pathJoin(dest, pathOut, 'dynamic-plugin-config.hash'), ph, 'utf8');
  console.error(`\t==> Successfully installed dynamic plugin ${pkg}`);
  for (const [k, v] of [...pluginPathByHash.entries()]) {
    if (v === pathOut) {
      pluginPathByHash.delete(k);
    }
  }
  const pc = pluginJson.pluginConfig;
  return JSON.stringify(pc && typeof pc === 'object' ? pc : {});
}

function checkYqNotNeeded(): void {
  /* YAML handled by the `yaml` package; kept for parity with env docs. */
}

export async function runMain(dynamicPluginsRoot: string): Promise<void> {
  needCmd('openssl');
  needCmd('npm');
  needCmd(process.execPath);
  checkYqNotNeeded();

  ociTmp = await mkdtemp(pathJoin(tmpdir(), 'oci-inst-'));
  mkdirSync(dynamicPluginsRoot, { recursive: true });
  const lockFile = pathJoin(dynamicPluginsRoot, '.install-dynamic-plugins.flock');
  const release = await lockfile.lock(lockFile, { realpath: false });
  try {
    console.error(`======= Acquiring lock ${lockFile}`);
    console.error(`======= Created lock file: ${lockFile}`);

    let catalogDefault = '';
    if (CATALOG_INDEX_IMAGE) {
      let entParent = CATALOG_ENTITIES_EXTRACT_DIR;
      if (!entParent) {
        entParent = pathJoin(process.env.TMPDIR || '/tmp', 'extensions');
      }
      catalogDefault = await extractCatalogIndex(
        CATALOG_INDEX_IMAGE,
        dynamicPluginsRoot,
        entParent
      );
    }

    const skipInt =
      SKIP_INTEGRITY_CHECK.toLowerCase() === 'true' || SKIP_INTEGRITY_CHECK === '1';

    const dynFile = 'dynamic-plugins.yaml';
    const globalOut = pathJoin(dynamicPluginsRoot, 'app-config.dynamic-plugins.yaml');

    if (!existsSync(dynFile)) {
      console.error(`No ${dynFile} file found. Skipping dynamic plugins installation.`);
      writeFileSync(globalOut, '', 'utf8');
      return;
    }

    let contentJson: Record<string, unknown>;
    try {
      const raw = readFileSync(dynFile, 'utf8');
      const { parse } = await import('yaml');
      const parsed = parse(raw) as Record<string, unknown> | null | undefined;
      contentJson = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      contentJson = {};
    }
    if (!contentJson || Object.keys(contentJson).length === 0) {
      console.error(`${dynFile} file is empty. Skipping dynamic plugins installation.`);
      writeFileSync(globalOut, '', 'utf8');
      return;
    }

    if (skipInt) {
      console.error(
        'SKIP_INTEGRITY_CHECK has been set to true, skipping integrity check of remote NPM packages'
      );
    }

    const merged = await mergeDynamicPlugins(dynFile, catalogDefault || '');

    let globalJson: Record<string, unknown> = {
      dynamicPlugins: { rootDirectory: 'dynamic-plugins-root' }
    };

    const pluginPathByHash = new Map<string, string>();
    for (const name of readdirSync(dynamicPluginsRoot)) {
      const d = pathJoin(dynamicPluginsRoot, name);
      if (!statSync(d).isDirectory()) {
        continue;
      }
      const h = pathJoin(d, 'dynamic-plugin-config.hash');
      if (existsSync(h)) {
        pluginPathByHash.set(readFileSync(h, 'utf8').trim(), name);
      }
    }

    for (const pjson of Object.values(merged)) {
      const rec = pjson as Record<string, unknown>;
      const ph = computePluginHash(rec);
      rec.plugin_hash = ph;
      const cfg = await installOnePlugin(dynamicPluginsRoot, rec, skipInt, pluginPathByHash);
      if (cfg !== '{}' && cfg) {
        globalJson = maybeMergeConfig(cfg, globalJson);
      }
    }

    const yamlBody = yamlStringify(globalJson, { lineWidth: 120 });
    writeFileSync(globalOut, yamlBody, 'utf8');

    for (const [, dirName] of pluginPathByHash.entries()) {
      console.error(`\n======= Removing previously installed dynamic plugin ${dirName}`);
      rmSync(pathJoin(dynamicPluginsRoot, dirName), { recursive: true, force: true });
    }

    cleanupCatalog(dynamicPluginsRoot);
  } finally {
    await release().catch(() => undefined);
    await rm(ociTmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
