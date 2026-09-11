import type { ScannedPluginPackage } from '@backstage/backend-dynamic-feature-service';

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

import { schemaLocator } from './schemaLocator';

jest.mock('fs');

function createPluginPackage(role: string): ScannedPluginPackage {
  return {
    location: url.pathToFileURL('/plugins/example-plugin'),
    manifest: {
      name: 'example-plugin',
      backstage: { role },
    },
  } as unknown as ScannedPluginPackage;
}

describe('schemaLocator', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers the modern dist/.config-schema.json path when it exists', () => {
    const existsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    expect(schemaLocator(createPluginPackage('backend-plugin'))).toBe(
      path.join('dist', '.config-schema.json'),
    );
    expect(existsSync).toHaveBeenCalledWith(
      path.resolve('/plugins/example-plugin', 'dist', '.config-schema.json'),
    );
  });

  it('falls back to the legacy dist/configSchema.json path for backend (node) plugins', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(schemaLocator(createPluginPackage('backend-plugin'))).toBe(
      path.join('dist', 'configSchema.json'),
    );
  });

  it('does not fall back to the legacy OFS/Scalprum dist-scalprum path for frontend (web) plugins', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(schemaLocator(createPluginPackage('frontend-plugin'))).toBe(
      path.join('dist', '.config-schema.json'),
    );
  });
});
