import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InstallException } from './errors.js';
import { verifyIntegrity } from './integrity.js';
import { log } from './log.js';
import { run } from './run.js';
import { extractNpmPackage } from './tar-extract.js';
import { CONFIG_HASH_FILE, isPluginDisabled, type Plugin } from './types.js';
import { markAsFresh } from './util.js';

export type NpmInstallResult = {
  pluginPath: string | null;
  pluginConfig: Record<string, unknown>;
};

/**
 * Install a single NPM-packaged (or local) plugin into `destination`.
 * Runs `npm pack` to produce the tarball, verifies integrity for remote
 * packages (unless skipped), then extracts.
 *
 * Concurrency is the caller's responsibility — `installNpm` in `index.ts`
 * runs a bounded `mapConcurrent` (default 3 workers via `getNpmWorkers()`)
 * over a list of plugins that have already passed the `definitelyNoOp`
 * pre-pass, so by the time this function is called the plugin definitely
 * needs work.
 */
export async function installNpmPlugin(
  plugin: Plugin,
  destination: string,
  skipIntegrity: boolean,
  installed: Map<string, string>,
): Promise<NpmInstallResult> {
  if (isPluginDisabled(plugin, log)) {
    return { pluginPath: null, pluginConfig: {} };
  }
  const hash = plugin.plugin_hash;
  if (!hash) {
    throw new InstallException(`Internal error: plugin ${plugin.package} missing plugin_hash`);
  }
  const pkg = plugin.package;
  const config: Record<string, unknown> = plugin.pluginConfig ?? {};

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
  if (!isSafeArchiveName(archiveName)) {
    throw new InstallException(
      `npm pack returned an unsafe filename for ${pkg}: '${archiveName}'`,
    );
  }
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
  if (!isNpmPackJsonEntry(first)) {
    throw new InstallException(`npm pack output missing 'filename' for ${actualPkg}`);
  }
  return first.filename;
}

function isNpmPackJsonEntry(value: unknown): value is { filename: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { filename?: unknown }).filename === 'string'
  );
}

/**
 * Reject any filename that would let `npm pack` escape `destination` once
 * passed to `path.join` — directory separators, leading `..`, or empty.
 * `npm pack` is expected to emit a flat `<name>-<version>.tgz`, so any
 * non-flat name is treated as adversarial.
 */
function isSafeArchiveName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.startsWith('..')) return false;
  return !/[/\\]/.test(name);
}
