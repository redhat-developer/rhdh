import type { LoggerService } from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';

import * as fs from 'node:fs';
import * as path from 'node:path';

const NFS_FEATURE_TYPES = new Set([
  '@backstage/FrontendPlugin',
  '@backstage/FrontendModule',
]);

/**
 * Read NFS feature types from a plugin's package.json.
 * Returns undefined if no features map is found, meaning the plugin
 * should pass through unfiltered for backwards compatibility.
 */
export function readBackstageFeatures(
  pluginName: string,
  pluginPackagePath: string,
  logger: LoggerService,
): Record<string, string> | undefined {
  try {
    const pkgJsonPath = path.join(pluginPackagePath, 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const features: Record<string, string> | undefined =
      pkgJson.backstage?.features;
    if (!features || Object.keys(features).length === 0) {
      return undefined;
    }
    return features;
  } catch (error) {
    logger.warn(
      `nfs-module-filter: failed to read package.json for plugin '${pluginName}': ${error}`,
    );
    return undefined;
  }
}

/**
 * Filter exposed modules to only those whose feature type is a NFS
 * frontend entrypoint (@backstage/FrontendPlugin or FrontendModule).
 *
 * When `features` is undefined the plugin has no backstage.features
 * metadata — all modules pass through for backwards compatibility.
 */
export function filterNfsExposedModules(
  pluginName: string,
  exposedModules: string[],
  _manifestContent: JsonObject,
  features: Record<string, string> | undefined,
  logger: LoggerService,
): string[] {
  if (!features) {
    return exposedModules;
  }

  const kept: string[] = [];
  const removed: string[] = [];

  for (const moduleName of exposedModules) {
    const mount =
      moduleName === '.' || moduleName.startsWith('./')
        ? moduleName
        : `./${moduleName}`;
    const featureType = features[mount];

    if (featureType !== undefined && NFS_FEATURE_TYPES.has(featureType)) {
      kept.push(moduleName);
    } else {
      removed.push(moduleName);
    }
  }

  if (removed.length > 0) {
    logger.info(
      `nfs-module-filter: plugin '${pluginName}': kept [${kept.join(', ')}], filtered out [${removed.join(', ')}]`,
    );
  }

  return kept;
}
