import type { LoggerService } from '@backstage/backend-plugin-api';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH,
  SHARED_ASSETS_DIST_DIR,
} from './dynamicFeaturesPreload/paths';
import type { PreloadStore } from './dynamicFeaturesPreload/store';

/**
 * Registry of shared dynamic-plugin assets, populated by scanning each
 * deployed plugin's `dist/shared/` directory
 * ({@link SHARED_ASSETS_DIST_DIR}).
 *
 * Maps file name → the file's contents plus the first deployed plugin
 * that provides it. Contents are read once at scan time — the same
 * pattern as the app-backend's static asset store — so the serving
 * route performs no per-request filesystem access. The registry is
 * also the allowlist: only names present in it are served, so path
 * traversal and unexpected files are excluded by construction.
 */
export type SharedAssetRegistry = Map<
  string,
  { content: Buffer; provider: string }
>;

function sha256_16(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Register every file of a deployed plugin's `dist/shared/` directory.
 *
 * The directory is a flat namespace: any file type is served at
 * `${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/<filename>`, and every
 * `.mjs` file additionally joins the preload store's modulepreload
 * list. Subdirectories are not served (logged once per entry).
 *
 * Files with the same name across plugins must be content-identical.
 * A conflict throws before any of the conflicting plugin's files are
 * registered: the upstream remotes router catches the error, logs it,
 * and skips the entire plugin — the only way to guarantee the
 * conflicting plugin's remote entry never loads bytes of a file it was
 * not built with. Identical content is deduped (the first provider
 * serves) with an info log.
 *
 * For every `.mjs` file, the canonical shared-assets URL
 * (`${backendBaseUrl}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/<file>`)
 * joins the preload store's modulepreload list — the URL that ESM
 * remote entries' baked relative runtime external resolves to.
 */
export function registerSharedAssets(
  registry: SharedAssetRegistry,
  store: PreloadStore,
  pluginPackagePath: string,
  pluginName: string,
  backendBaseUrl: string,
  logger: LoggerService,
): void {
  const sharedRoot = path.join(
    pluginPackagePath,
    'dist',
    SHARED_ASSETS_DIST_DIR,
  );
  if (!fs.existsSync(sharedRoot)) {
    return;
  }

  const entries: { name: string; filePath: string }[] = [];
  for (const name of fs.readdirSync(sharedRoot)) {
    const filePath = path.join(sharedRoot, name);
    if (!fs.statSync(filePath).isFile()) {
      logger.warn(
        `dynamic-features-resolver: ignoring '${path.join(SHARED_ASSETS_DIST_DIR, name)}' of ${pluginName}: subdirectories are not served`,
      );
      continue;
    }
    entries.push({ name, filePath });
  }

  // Read every candidate's contents up front: the conflict check
  // compares buffers and registration stores the content — the
  // in-memory snapshot the serving route reads from.
  const contents = new Map(
    entries.map(({ name, filePath }) => [name, fs.readFileSync(filePath)]),
  );

  // Validate every already-registered name before registering any of
  // this plugin's files, so a conflicting plugin contributes no shared
  // assets at all.
  for (const { name } of entries) {
    const existing = registry.get(name);
    if (existing && !existing.content.equals(contents.get(name)!)) {
      throw new Error(
        `Shared asset conflict: '${name}' from plugin '${pluginName}' (sha256:${sha256_16(contents.get(name)!)}) differs from the copy registered by plugin '${existing.provider}' (sha256:${sha256_16(existing.content)}). Files under dist/${SHARED_ASSETS_DIST_DIR} must be content-identical across plugins.`,
      );
    }
  }

  for (const { name } of entries) {
    if (registry.has(name)) {
      logger.info(
        `dynamic-features-resolver: shared asset ${name} from ${pluginName} identical to the one served for ${registry.get(name)!.provider}`,
      );
    } else {
      registry.set(name, {
        content: contents.get(name)!,
        provider: pluginName,
      });
      logger.info(
        `dynamic-features-resolver: registered shared asset ${name} from ${pluginName}`,
      );
      if (name.endsWith('.mjs')) {
        // The canonical URL that ESM remote entries' baked relative
        // runtime external resolves to — modulepreloaded by preload.js.
        store.sharedModuleUrls.push(
          `${backendBaseUrl}${DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH}/${name}`,
        );
      }
    }
  }
}
