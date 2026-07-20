import { createInstance } from '@module-federation/enhanced/runtime';
import {
  createFrontendFeatureLoader,
  type FrontendFeature,
  type FrontendFeatureLoader,
} from '@backstage/frontend-plugin-api';
import { loadModuleFederationHostShared } from '@backstage/module-federation-common';
import type { DynamicFrontendFeaturesLoaderOptions } from '@backstage/frontend-dynamic-feature-loader';
import { collectLoadableFeatures } from './collectLoadableFeatures';

type FrontendPluginRemote = {
  packageName: string;
  remoteInfo: { name: string; entry: string };
  exposedModules: string[];
};

/**
 * Like `@backstage/frontend-dynamic-feature-loader`, but also registers named
 * `FrontendPlugin` / `FrontendModule` exports from each remote module.
 *
 * The stock loader only keeps `module.default`. That misses shells that ship as
 * named exports next to a default plugin — e.g. global-header's
 * `globalHeaderModule` (AppRootWrapper) beside default `globalHeaderPlugin`.
 */
export function rhdhDynamicFrontendFeaturesLoader(
  options?: DynamicFrontendFeaturesLoaderOptions,
): FrontendFeatureLoader {
  return createFrontendFeatureLoader({
    async loader({ config }) {
      if (!config.getOptionalConfig('dynamicPlugins')) {
        return [];
      }

      const error = (message: string, err: unknown) => {
        // eslint-disable-next-line no-console
        console.error(
          `${message}: ${
            err instanceof Error ? err.toString() : JSON.stringify(err)
          }`,
        );
      };

      const backendBaseUrl = config.getString('backend.baseUrl');
      const appPackageName =
        config.getOptionalString('app.packageName') ?? 'app';

      let frontendPluginRemotes: FrontendPluginRemote[];
      try {
        const response = await fetch(
          `${backendBaseUrl}/.backstage/dynamic-features/remotes`,
        );
        if (!response.ok) {
          throw new Error(`${response.status} - ${response.statusText}`);
        }
        frontendPluginRemotes = (await response.json()) as FrontendPluginRemote[];
      } catch (err) {
        error(
          'Failed fetching module federation configuration of dynamic frontend plugins',
          err,
        );
        return [];
      }

      let instance;
      try {
        if (options?.moduleFederation?.instance) {
          instance = options.moduleFederation.instance;
        } else {
          const shared = await loadModuleFederationHostShared({
            onError: err => error(err.message, err.cause),
          });
          // Keep options untyped: duplicate @module-federation/runtime-core
          // copies under enhanced vs host resolve to incompatible UserOptions.
          const createOptions = {
            name: appPackageName
              .replaceAll('@', '')
              .replaceAll('/', '__')
              .replaceAll('-', '_'),
            shared,
            remotes: [] as [],
            ...(options?.moduleFederation?.shareStrategy
              ? { shareStrategy: options.moduleFederation.shareStrategy }
              : {}),
          };
          instance = createInstance(createOptions);
        }

        const userOptions = {
          name: instance.name,
          remotes: frontendPluginRemotes.map(remote => ({
            alias: remote.packageName,
            ...remote.remoteInfo,
          })),
          ...(options?.moduleFederation?.plugins
            ? { plugins: options.moduleFederation.plugins }
            : {}),
          ...(options?.moduleFederation?.shareStrategy
            ? { shareStrategy: options.moduleFederation.shareStrategy }
            : {}),
          ...(options?.moduleFederation?.shared
            ? { shared: options.moduleFederation.shared }
            : {}),
        };
        instance.initOptions(userOptions);
      } catch (err) {
        error('Failed initializing module federation', err);
        return [];
      }

      const features = (
        await Promise.all(
          frontendPluginRemotes.map(async remote => {
            // eslint-disable-next-line no-console
            console.debug(
              `Loading dynamic plugin '${remote.packageName}' from '${remote.remoteInfo.entry}'`,
            );
            const moduleFeatures = await Promise.all(
              remote.exposedModules.map(async exposedModuleName => {
                const remoteModuleName =
                  exposedModuleName === '.'
                    ? remote.remoteInfo.name
                    : `${remote.remoteInfo.name}/${exposedModuleName}`;
                let remoteModule: Record<string, unknown> | undefined;
                try {
                  remoteModule = (await instance.loadRemote(
                    remoteModuleName,
                  )) as Record<string, unknown> | undefined;
                } catch (err) {
                  error(
                    `Failed loading remote module '${remoteModuleName}' of dynamic plugin '${remote.packageName}'`,
                    err,
                  );
                  return [] as FrontendFeature[];
                }
                if (!remoteModule) {
                  // eslint-disable-next-line no-console
                  console.warn(
                    `Skipping empty dynamic plugin remote module '${remoteModuleName}'.`,
                  );
                  return [] as FrontendFeature[];
                }
                // eslint-disable-next-line no-console
                console.info(
                  `Remote module '${remoteModuleName}' of dynamic plugin '${remote.packageName}' loaded from ${remote.remoteInfo.entry}`,
                );
                const collected = collectLoadableFeatures(remoteModule);
                if (collected.length === 0) {
                  // eslint-disable-next-line no-console
                  console.debug(
                    `Skipping dynamic plugin remote module '${remoteModuleName}' since it doesn't export a new FrontendFeature (default or named).`,
                  );
                }
                return collected;
              }),
            );
            return moduleFeatures.flat();
          }),
        )
      ).flat();

      return features;
    },
  });
}
