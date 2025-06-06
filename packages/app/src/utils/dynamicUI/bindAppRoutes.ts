import { AppRouteBinder } from '@backstage/core-app-api';
import { BackstagePlugin } from '@backstage/core-plugin-api';
import { apiDocsPlugin } from '@backstage/plugin-api-docs';
import { catalogPlugin } from '@backstage/plugin-catalog';
import { catalogImportPlugin } from '@backstage/plugin-catalog-import';
import { orgPlugin } from '@backstage/plugin-org';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';

import { RouteBinding } from '@red-hat-developer-hub/plugin-utils';
import get from 'lodash/get';

const bindAppRoutes = (
  bind: AppRouteBinder,
  routeBindingTargets: { [key: string]: BackstagePlugin<{}> },
  routeBindings: RouteBinding[],
) => {
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

  const availableBindPlugins = {
    ...routeBindingTargets,
    catalogPlugin,
    catalogImportPlugin,
    scaffolderPlugin,
  };

  // binds from remote
  routeBindings.forEach(({ bindTarget, bindMap }) => {
    const externalRoutes = get(availableBindPlugins, bindTarget);
    const targetRoutes = Object.entries(bindMap).reduce<{ [key: string]: any }>(
      (acc, [key, value]) => {
        acc[key] = get(availableBindPlugins, value);
        return acc;
      },
      {},
    ) as any;
    if (
      externalRoutes &&
      Object.keys(externalRoutes).length > 0 &&
      Object.keys(targetRoutes).length > 0
    ) {
      bind(externalRoutes, targetRoutes);
    }
  });
};

export default bindAppRoutes;
