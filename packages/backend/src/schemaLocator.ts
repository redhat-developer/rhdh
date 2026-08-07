import { PackageRoles } from '@backstage/cli-node';

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

import type { ScannedPluginPackage } from '@backstage/backend-dynamic-feature-service';

/**
 * Locates the config schema file for a scanned dynamic plugin package.
 *
 * RHIDP-15079 (partial): prefers the modern `dist/.config-schema.json` path
 * written by `@backstage/cli`'s `cli-module-build` bundler for both frontend
 * and backend packages, falling back to the legacy per-platform path written
 * by the old janus-idp/cli (Scalprum) toolchain.
 *
 * The legacy fallback should be removed entirely once the legacy OFS frontend
 * is deleted in RHIDP-15078/RHIDP-15079.
 */
export function schemaLocator(pluginPackage: ScannedPluginPackage): string {
  const pluginLocation = url.fileURLToPath(pluginPackage.location);
  const modernSchemaPath = path.join('dist', '.config-schema.json');
  if (fs.existsSync(path.resolve(pluginLocation, modernSchemaPath))) {
    return modernSchemaPath;
  }

  const platform = PackageRoles.getRoleInfo(
    pluginPackage.manifest.backstage.role,
  ).platform;
  return path.join(
    platform === 'node' ? 'dist' : 'dist-scalprum',
    'configSchema.json',
  );
}
