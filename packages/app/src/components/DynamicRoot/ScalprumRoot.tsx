/* eslint-disable @typescript-eslint/no-shadow */

import useAsync from 'react-use/lib/useAsync';

import { AppConfig } from '@backstage/config';
import { ConfigReader, defaultConfigLoader } from '@backstage/core-app-api';
import { AnyApiFactory } from '@backstage/core-plugin-api';

import { DynamicRootConfig } from '@red-hat-developer-hub/plugin-utils';
import { AppsConfig } from '@scalprum/core';
import { ScalprumProvider } from '@scalprum/react-core';

import { TranslationConfig } from '../../types/types';
import { CatalogColumnConfig } from '../../utils/catalog';
import { DynamicPluginConfig } from '../../utils/dynamicUI/extractDynamicConfig';
import overrideBaseUrlConfigs from '../../utils/dynamicUI/overrideBaseUrlConfigs';
import { DynamicRoot, StaticPlugins } from './DynamicRoot';
import Loader from './Loader';

export type ScalprumApiHolder = {
  dynamicRootConfig: DynamicRootConfig;
};

const ScalprumRoot = ({
  apis,
  afterInit,
  baseFrontendConfig,
  plugins,
}: {
  // Static APIs
  apis: AnyApiFactory[];
  afterInit: () => Promise<{ default: React.ComponentType }>;
  baseFrontendConfig?: AppConfig;
  plugins?: StaticPlugins;
}) => {
  const { loading, value } = useAsync(
    async (): Promise<{
      dynamicPlugins: DynamicPluginConfig;
      baseUrl: string;
      scalprumConfig?: AppsConfig;
      translationConfig?: TranslationConfig;
      catalogColumnConfig?: CatalogColumnConfig;
    }> => {
      const appConfig = overrideBaseUrlConfigs(await defaultConfigLoader());
      const reader = ConfigReader.fromConfigs([
        baseFrontendConfig ?? { context: '', data: {} },
        ...appConfig,
      ]);
      const baseUrl = reader.getString('backend.baseUrl');
      const dynamicPlugins = reader.get<DynamicPluginConfig>('dynamicPlugins');
      let scalprumConfig: AppsConfig = {};
      let translationConfig: TranslationConfig | undefined = undefined;
      let catalogColumnConfig: CatalogColumnConfig | undefined = undefined;
      try {
        scalprumConfig = await fetch(`${baseUrl}/api/scalprum/plugins`).then(
          r => r.json(),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `Failed to fetch scalprum configuration: ${JSON.stringify(err)}`,
        );
      }
      try {
        translationConfig = reader.get<TranslationConfig>('i18n');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `Failed to load i18n configuration: either not provided or invalid.
 ${JSON.stringify(err)}`,
        );
      }
      try {
        catalogColumnConfig = reader.getOptional<CatalogColumnConfig>(
          'catalog.table.columns',
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `Failed to load catalog column configuration: ${JSON.stringify(err)}`,
        );
      }
      return {
        dynamicPlugins,
        baseUrl,
        scalprumConfig,
        translationConfig,
        catalogColumnConfig,
      };
    },
  );
  if (loading && !value) {
    return <Loader />;
  }
  const {
    dynamicPlugins,
    baseUrl,
    scalprumConfig,
    translationConfig,
    catalogColumnConfig,
  } = value || {};
  const scalprumApiHolder = {
    dynamicRootConfig: {
      dynamicRoutes: [],
      menuItems: [],
      entityTabOverrides: {},
      mountPoints: {},
      scaffolderFieldExtensions: [],
      techdocsAddons: [],
      providerSettings: [],
      translationRefs: [],
      catalogTableColumns: catalogColumnConfig,
    } as DynamicRootConfig,
  };
  return (
    <ScalprumProvider<ScalprumApiHolder>
      api={scalprumApiHolder}
      config={scalprumConfig ?? {}}
      pluginSDKOptions={{
        pluginLoaderOptions: {
          transformPluginManifest: manifest => {
            return {
              ...manifest,
              loadScripts: manifest.loadScripts.map(
                (script: string) =>
                  `${baseUrl ?? ''}/api/scalprum/${manifest.name}/${script}`,
              ),
            };
          },
        },
      }}
    >
      <DynamicRoot
        afterInit={afterInit}
        apis={apis}
        dynamicPlugins={dynamicPlugins ?? {}}
        staticPluginStore={plugins}
        scalprumConfig={scalprumConfig ?? {}}
        translationConfig={translationConfig}
        catalogColumnConfig={catalogColumnConfig}
        baseUrl={baseUrl as string}
      />
    </ScalprumProvider>
  );
};

export default ScalprumRoot;
