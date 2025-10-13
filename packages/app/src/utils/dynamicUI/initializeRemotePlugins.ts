import { AppsConfig, processManifest } from '@scalprum/core';
import { ScalprumState } from '@scalprum/react-core';

import { RemotePlugins } from '../../components/DynamicRoot/DynamicRoot';

// See packages/app/src/App.tsx
const ignoreStaticPlugins = ['default.main-menu-items'];

const initializeRemotePlugins = async (
  pluginStore: ScalprumState['pluginStore'],
  scalprumConfig: AppsConfig,
  requiredModules: { scope: string; module: string }[],
): Promise<RemotePlugins> => {
  await Promise.allSettled(
    requiredModules.map(({ scope, module }) =>
      processManifest(scalprumConfig[scope]?.manifestLocation!, scope, module),
    ),
  );
  let remotePlugins = await Promise.all(
    requiredModules
      .filter(({ scope }) => !ignoreStaticPlugins.includes(scope))
      .map(({ scope, module }) =>
        pluginStore
          .getExposedModule<{
            [importName: string]: React.ComponentType<{}>;
          }>(scope, module)
          .catch(error => {
            // eslint-disable-next-line no-console
            console.error(`Failed to load plugin ${scope}`, error);
            return undefined;
          })
          .then(remoteModule => ({
            module,
            scope,
            remoteModule,
          })),
      ),
  );
  // remove all remote modules that are undefined
  remotePlugins = remotePlugins.filter(({ remoteModule }) =>
    Boolean(remoteModule),
  );
  const scopedRegistry = remotePlugins.reduce<RemotePlugins>((acc, curr) => {
    if (!curr.remoteModule) return acc;
    if (!acc[curr.scope]) {
      acc[curr.scope] = {};
    }
    if (!acc[curr.scope][curr.module]) {
      acc[curr.scope][curr.module] = {};
    }

    acc[curr.scope][curr.module] = curr.remoteModule;
    return acc;
  }, {});
  return scopedRegistry;
};

export default initializeRemotePlugins;
