import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InstallException } from './errors.js';
import { type OciImageCache } from './image-cache.js';
import { log } from './log.js';
import { extractOciPlugin } from './tar-extract.js';
import {
  CONFIG_HASH_FILE,
  IMAGE_HASH_FILE,
  LATEST_TAG_MARKER,
  type Plugin,
  PullPolicy,
} from './types.js';
import { fileExists, markAsFresh } from './util.js';

export type OciInstallResult = {
  /** The installed plugin's directory name (relative to destination), or null when skipped. */
  pluginPath: string | null;
  pluginConfig: Record<string, unknown>;
};

/**
 * Install a single OCI-packaged plugin into `destination`. Returns the
 * on-disk directory name and the plugin's own config (for merging into the
 * global app-config).
 */
export async function installOciPlugin(
  plugin: Plugin,
  destination: string,
  imageCache: OciImageCache,
  installed: Map<string, string>,
): Promise<OciInstallResult> {
  if (plugin.disabled) {
    return { pluginPath: null, pluginConfig: {} };
  }
  const hash = plugin.plugin_hash;
  if (!hash) {
    throw new InstallException(`Internal error: plugin ${plugin.package} missing plugin_hash`);
  }
  const pkg = plugin.package;
  const config: Record<string, unknown> = plugin.pluginConfig ?? {};
  const pullPolicy = resolvePullPolicy(plugin, pkg);

  if (await isAlreadyInstalled(pkg, hash, pullPolicy, destination, imageCache, installed)) {
    installed.delete(hash);
    return { pluginPath: null, pluginConfig: config };
  }

  if (!plugin.version) {
    throw new InstallException(`No version for ${pkg}`);
  }
  const [imagePart, pluginPath] = pkg.split('!');
  if (!pluginPath || !imagePart) {
    throw new InstallException(`OCI package ${pkg} missing !plugin-path suffix`);
  }

  const tarball = await imageCache.getTarball(imagePart);
  await extractOciPlugin(tarball, pluginPath, destination);

  const pluginDir = path.join(destination, pluginPath);
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, IMAGE_HASH_FILE), await imageCache.getDigest(imagePart));
  await fs.writeFile(path.join(pluginDir, CONFIG_HASH_FILE), hash);

  markAsFresh(installed, pluginPath);
  return { pluginPath, pluginConfig: config };
}

function resolvePullPolicy(plugin: Plugin, pkg: string): PullPolicy {
  if (plugin.pullPolicy) return plugin.pullPolicy;
  return pkg.includes(LATEST_TAG_MARKER) ? PullPolicy.ALWAYS : PullPolicy.IF_NOT_PRESENT;
}

/**
 * Returns true when the plugin is already installed and can be skipped:
 *   - IfNotPresent policy → skip unconditionally
 *   - Always policy → skip only when the remote digest matches what's on disk
 */
async function isAlreadyInstalled(
  pkg: string,
  hash: string,
  pullPolicy: PullPolicy,
  destination: string,
  imageCache: OciImageCache,
  installed: Map<string, string>,
): Promise<boolean> {
  const pathInstalled = installed.get(hash);
  if (pathInstalled === undefined) return false;

  if (pullPolicy === PullPolicy.IF_NOT_PRESENT) {
    log(`\t==> ${pkg}: already installed, skipping`);
    return true;
  }

  if (pullPolicy !== PullPolicy.ALWAYS) return false;

  const digestFile = path.join(destination, pathInstalled, IMAGE_HASH_FILE);
  if (!(await fileExists(digestFile))) return false;

  const localDigest = (await fs.readFile(digestFile, 'utf8')).trim();
  const imagePart = pkg.split('!')[0];
  if (!imagePart) return false;
  const remoteDigest = await imageCache.getDigest(imagePart);
  if (localDigest !== remoteDigest) return false;

  log(`\t==> ${pkg}: digest unchanged, skipping`);
  return true;
}
