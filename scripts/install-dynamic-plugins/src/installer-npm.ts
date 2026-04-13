import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InstallException } from './errors.js';
import { verifyIntegrity } from './integrity.js';
import { log } from './log.js';
import { run } from './run.js';
import { extractNpmPackage } from './tar-extract.js';
import { CONFIG_HASH_FILE, type Plugin, PullPolicy } from './types.js';

export type NpmInstallResult = {
  pluginPath: string | null;
  pluginConfig: Record<string, unknown>;
};

/**
 * Install a single NPM-packaged (or local) plugin into `destination`.
 * Uses `npm pack` to produce the tarball, verifies integrity for remote
 * packages (unless skipped), then extracts. NPM installs are kept sequential
 * (no outer parallelism) to avoid registry throttling.
 */
export async function installNpmPlugin(
  plugin: Plugin,
  destination: string,
  skipIntegrity: boolean,
  installed: Map<string, string>,
): Promise<NpmInstallResult> {
  if (plugin.disabled) {
    return { pluginPath: null, pluginConfig: {} };
  }
  const hash = plugin.plugin_hash;
  if (!hash) {
    throw new InstallException(`Internal error: plugin ${plugin.package} missing plugin_hash`);
  }
  const pkg = plugin.package;
  const force = plugin.forceDownload ?? false;
  const config = (plugin.pluginConfig ?? {}) as Record<string, unknown>;

  if (installed.has(hash) && !force) {
    const pullPolicy = plugin.pullPolicy ?? PullPolicy.IF_NOT_PRESENT;
    if (pullPolicy !== PullPolicy.ALWAYS) {
      log('\t==> Already installed, skipping');
      installed.delete(hash);
      return { pluginPath: null, pluginConfig: config };
    }
  }

  const isLocal = pkg.startsWith('./');
  const actualPkg = isLocal ? path.join(process.cwd(), pkg.slice(2)) : pkg;

  if (!isLocal && !skipIntegrity && !plugin.integrity) {
    throw new InstallException(
      `No integrity hash provided for Package ${pkg}. This is an insecure installation. ` +
        `To ignore this error, set the SKIP_INTEGRITY_CHECK environment variable to 'true'.`,
    );
  }

  log('\t==> Running npm pack');
  const { stdout } = await run(['npm', 'pack', actualPkg], `npm pack failed for ${pkg}`, {
    cwd: destination,
  });
  const archiveName = stdout.trim().split('\n').slice(-1)[0];
  if (!archiveName) {
    throw new InstallException(`npm pack produced no archive for ${pkg}`);
  }
  const archive = path.join(destination, archiveName);

  if (!isLocal && !skipIntegrity && plugin.integrity) {
    log('\t==> Verifying package integrity');
    await verifyIntegrity(pkg, archive, plugin.integrity);
  }

  const pluginPath = await extractNpmPackage(archive);
  await fs.writeFile(path.join(destination, pluginPath, CONFIG_HASH_FILE), hash);

  for (const [k, v] of installed) {
    if (v === pluginPath) installed.delete(k);
  }

  return { pluginPath, pluginConfig: config };
}
