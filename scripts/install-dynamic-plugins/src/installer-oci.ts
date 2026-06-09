import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InstallException } from './errors.js';
import { type OciImageCache } from './image-cache.js';
import { log } from './log.js';
import { extractOciPlugin } from './tar-extract.js';
import {
  CONFIG_HASH_FILE,
  effectivePullPolicy,
  IMAGE_HASH_FILE,
  isPluginDisabled,
  type Plugin,
  PullPolicy,
} from './types.js';
import { fileExists, markAsFresh } from './util.js';

/**
 * Split an OCI package spec into `<image-part>!<plugin-path>`. Uses
 * `indexOf` so plugin paths containing `!` (legal per the OCI grammar) are
 * preserved on the right side instead of being silently truncated by
 * `String#split`.
 */
function splitOciPackage(pkg: string): { imagePart: string; pluginPath: string } | null {
  const bang = pkg.indexOf('!');
  if (bang === -1) return null;
  const imagePart = pkg.slice(0, bang);
  const pluginPath = pkg.slice(bang + 1);
  if (!imagePart || !pluginPath) return null;
  return { imagePart, pluginPath };
}

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
  if (isPluginDisabled(plugin, log)) {
    return { pluginPath: null, pluginConfig: {} };
  }
  const hash = plugin.plugin_hash;
  if (!hash) {
    throw new InstallException(`Internal error: plugin ${plugin.package} missing plugin_hash`);
  }
  const pkg = plugin.package;
  const config: Record<string, unknown> = plugin.pluginConfig ?? {};
  const pullPolicy = effectivePullPolicy(plugin);

  if (await isAlreadyInstalled(pkg, hash, pullPolicy, destination, imageCache, installed)) {
    installed.delete(hash);
    return { pluginPath: null, pluginConfig: config };
  }

  if (!plugin.version) {
    throw new InstallException(`No version for ${pkg}`);
  }
  const parts = splitOciPackage(pkg);
  if (!parts) {
    throw new InstallException(`OCI package ${pkg} missing !plugin-path suffix`);
  }
  const { imagePart, pluginPath } = parts;

  const tarball = await imageCache.getTarball(imagePart);
  await extractOciPlugin(tarball, pluginPath, destination);

  const pluginDir = path.join(destination, pluginPath);
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, IMAGE_HASH_FILE), await imageCache.getDigest(imagePart));
  await fs.writeFile(path.join(pluginDir, CONFIG_HASH_FILE), hash);

  markAsFresh(installed, pluginPath);
  return { pluginPath, pluginConfig: config };
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
  const parts = splitOciPackage(pkg);
  if (!parts) return false;
  const remoteDigest = await imageCache.getDigest(parts.imagePart);
  if (localDigest !== remoteDigest) return false;

  log(`\t==> ${pkg}: digest unchanged, skipping`);
  return true;
}
