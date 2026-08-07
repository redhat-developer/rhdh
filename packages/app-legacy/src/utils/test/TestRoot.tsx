import { PropsWithChildren, useMemo, useRef } from 'react';

import { createApp } from '@backstage/app-defaults';
import { BackstageApp } from '@backstage/core-app-api';
import { apiDocsPlugin } from '@backstage/plugin-api-docs';
import { catalogPlugin } from '@backstage/plugin-catalog';
import { catalogImportPlugin } from '@backstage/plugin-catalog-import';
import { orgPlugin } from '@backstage/plugin-org';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

import { apis } from '../../apis';

const TestRoot = ({ children }: PropsWithChildren<{}>) => {
  const { current } = useRef<BackstageApp>(
    createApp({
      apis,
      bindRoutes: ({ bind }) => {
        // Static bindings
        bind(catalogPlugin.externalRoutes, {
          createComponent: scaffolderPlugin.routes.root,
          createFromTemplate: scaffolderPlugin.routes.selectedTemplate,
        });
        bind(apiDocsPlugin.externalRoutes, {
          registerApi: catalogImportPlugin.routes.importPage,
        });
        bind(scaffolderPlugin.externalRoutes, {
          registerComponent: catalogImportPlugin.routes.importPage,
        });
        bind(orgPlugin.externalRoutes, {
          catalogIndex: catalogPlugin.routes.catalogIndex,
        });
      },
    }),
  );
  const value = useMemo(
    () => ({
      AppProvider: current.getProvider(),
      AppRouter: current.getRouter(),
      dynamicRoutes: [],
      menuItems: [],
      mountPoints: {},
      entityTabOverrides: {},
      scaffolderFieldExtensions: [],
      providerSettings: [],
      techdocsAddons: [],
      translationRefs: [],
    }),
    [current],
  );

  return (
    <DynamicRootContext.Provider value={value}>
      {children}
    </DynamicRootContext.Provider>
  );
};

export default TestRoot;
