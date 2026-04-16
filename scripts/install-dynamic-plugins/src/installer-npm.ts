import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InstallException } from './errors.js';
import { verifyIntegrity } from './integrity.js';
import { log } from './log.js';
import { run } from './run.js';
import { extractNpmPackage } from './tar-extract.js';
import { CONFIG_HASH_FILE, type Plugin, PullPolicy } from './types.js';
import { markAsFresh } from './util.js';

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
  const config: Record<string, unknown> = plugin.pluginConfig ?? {};

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

  const verifyRemoteIntegrity = !isLocal && !skipIntegrity;
  if (verifyRemoteIntegrity && !plugin.integrity) {
    throw new InstallException(
      `No integrity hash provided for Package ${pkg}. This is an insecure installation. ` +
        `To ignore this error, set the SKIP_INTEGRITY_CHECK environment variable to 'true'.`,
    );
  }

  log('\t==> Running npm pack');
  const archiveName = await npmPack(actualPkg, destination);
  const archive = path.join(destination, archiveName);

  if (verifyRemoteIntegrity) {
    log('\t==> Verifying package integrity');
    // `plugin.integrity` is guaranteed present — the check above throws otherwise.
    await verifyIntegrity(pkg, archive, plugin.integrity as string);
  }

  const pluginPath = await extractNpmPackage(archive);
  await fs.writeFile(path.join(destination, pluginPath, CONFIG_HASH_FILE), hash);

  markAsFresh(installed, pluginPath);
  return { pluginPath, pluginConfig: config };
}

/**
 * Run `npm pack --json` and extract the archive filename from the structured
 * output. The text form of `npm pack` intermixes warnings with the filename
 * (last-line parsing is fragile); `--json` gives `[{ filename, ... }]`.
 */
async function npmPack(actualPkg: string, destination: string): Promise<string> {
  // `--ignore-scripts` blocks `preinstall` / `prepack` / `prepare` lifecycle
  // hooks that NPM packages can declare. Dynamic plugins are not expected
  // to ship build steps that need to run at install time, and skipping the
  // hooks both removes a code-execution-on-install attack surface and
  // shaves a fork+exec per package off the wall clock.
  const { stdout } = await run(
    ['npm', 'pack', '--json', '--ignore-scripts', actualPkg],
    `npm pack failed for ${actualPkg}`,
    { cwd: destination },
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new InstallException(
      `npm pack produced invalid JSON for ${actualPkg}: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new InstallException(`npm pack produced no archives for ${actualPkg}`);
  }
  const first = parsed[0];
  if (
    !first ||
    typeof first !== 'object' ||
    typeof (first as { filename?: unknown }).filename !== 'string'
  ) {
    throw new InstallException(`npm pack output missing 'filename' for ${actualPkg}`);
  }
  return (first as { filename: string }).filename;
}
