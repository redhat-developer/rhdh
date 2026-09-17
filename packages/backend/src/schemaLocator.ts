import type { ScannedPluginPackage } from '@backstage/backend-dynamic-feature-service';
import { PackageRoles } from '@backstage/cli-node';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

/**
 * Locates the config schema file for a scanned dynamic plugin package.
 *
 * RHIDP-15079 (partial): prefers the modern `dist/.config-schema.json` path
 * written by `@backstage/cli`'s `cli-module-build` bundler for both frontend
 * and backend packages, falling back to the legacy `dist/configSchema.json`
 * path for backend (node) packages predating that bundler.
 *
 * The legacy `dist-scalprum/configSchema.json` fallback for frontend (web)
 * packages — the old janus-idp/cli (OFS/Scalprum) toolchain's output — was
 * removed now that RHDH only ships the new frontend system (`packages/app`).
 * A frontend dynamic plugin without the modern schema path simply has no
 * config schema gathered for it (see `gatherDynamicPluginsSchemas`, which
 * skips missing files gracefully).
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
  return platform === 'node'
    ? path.join('dist', 'configSchema.json')
    : modernSchemaPath;
}
