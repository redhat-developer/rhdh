import { glob } from 'glob';

import fs from 'node:fs';
import path from 'node:path';

import { InternalPluginsMap } from './InternalPluginsMap';

const PACKAGE_JSON_GLOB = '**/package.json';
const IGNORE_GLOB = ['**/node_modules/**', '**/dist-dynamic/**'];

const ROOT_DIR = path.join(__dirname, '../../../..');
const DYNAMIC_PLUGINS_DIR = path.join(ROOT_DIR, 'dynamic-plugins/wrappers');

type WrapperFrontendPackageJson = {
  name: string;
  backstage: {
    role: 'frontend-plugin';
  };
  scalprum: {
    name: string;
  };
  repository: {
    directory: string;
  };
};

type WrapperBackendPackageJson = {
  name: string;
  backstage: {
    role: 'backend-plugin' | 'backend-plugin-module';
  };
  repository: {
    directory: string;
  };
};

type WrapperPackageJson =
  | WrapperFrontendPackageJson
  | WrapperBackendPackageJson;

function isFrontendPlugin(
  packageJson: WrapperPackageJson,
): packageJson is WrapperFrontendPackageJson {
  return packageJson.backstage.role === 'frontend-plugin';
}

function isBackendPlugin(
  packageJson: WrapperPackageJson,
): packageJson is WrapperBackendPackageJson {
  return (
    packageJson.backstage.role === 'backend-plugin' ||
    packageJson.backstage.role === 'backend-plugin-module'
  );
}

function getDifference<T>(arrA: T[], arrB: T[]): T[] {
  return arrA.filter(x => !arrB.includes(x));
}

describe('InternalPluginsMap', () => {
  const wrapperPackageJsonPaths = glob.sync(PACKAGE_JSON_GLOB, {
    cwd: DYNAMIC_PLUGINS_DIR, // Search only within DYNAMIC_PLUGINS_DIR
    ignore: IGNORE_GLOB,
  });

  const wrapperDirNames = wrapperPackageJsonPaths.map(path.dirname);

  const wrapperPackageJsonFiles = wrapperPackageJsonPaths.map(
    packageJsonPath => {
      const packageJson = fs.readFileSync(
        path.join(DYNAMIC_PLUGINS_DIR, packageJsonPath),
      );
      return JSON.parse(packageJson.toString()) as WrapperPackageJson;
    },
  );
  const frontendPackageJsonFiles = wrapperPackageJsonFiles.filter(packageJson =>
    isFrontendPlugin(packageJson),
  );
  const backendPackageJsonFiles = wrapperPackageJsonFiles.filter(packageJson =>
    isBackendPlugin(packageJson),
  );

  it('should have a valid map', () => {
    const difference = getDifference(
      Object.keys(InternalPluginsMap),
      wrapperDirNames,
    );

    try {
      expect(difference).toStrictEqual([]);
    } catch {
      throw new Error(
        `The following plugins are missing: ${difference.join(', ')}`,
      );
    }
  });

  it.each(backendPackageJsonFiles)(
    '$name should have a `-dynamic` suffix in the directory name',
    ({ name }) => {
      const hasDynamicSuffix = Object.values(InternalPluginsMap).some(value =>
        value.includes(`${name}-dynamic`),
      );
      expect(hasDynamicSuffix).toBeTruthy();
    },
  );

  it.each(frontendPackageJsonFiles)(
    '$name should have a matching directory name',
    ({ name }) => {
      const hasMatchingDirName = Object.values(InternalPluginsMap).some(value =>
        value.includes(name),
      );
      expect(hasMatchingDirName).toBeTruthy();
    },
  );
});
