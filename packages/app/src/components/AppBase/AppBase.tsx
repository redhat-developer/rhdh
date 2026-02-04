import { useContext, useMemo } from 'react';
import { Route } from 'react-router-dom';

import { FlatRoutes } from '@backstage/core-app-api';
import {
  AlertDisplay,
  AutoLogout,
  OAuthRequestDialog,
} from '@backstage/core-components';
import { ApiExplorerPage } from '@backstage/plugin-api-docs';
import { CatalogEntityPage, CatalogIndexPage } from '@backstage/plugin-catalog';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { CatalogGraphPage } from '@backstage/plugin-catalog-graph';
import { CatalogImportPage } from '@backstage/plugin-catalog-import';
import { RequirePermission } from '@backstage/plugin-permission-react';
import { ScaffolderPage } from '@backstage/plugin-scaffolder';
import { ScaffolderFieldExtensions } from '@backstage/plugin-scaffolder-react';
import { SearchPage as BackstageSearchPage } from '@backstage/plugin-search';
import { UserSettingsPage } from '@backstage/plugin-user-settings';

import DynamicRootContext from '@red-hat-developer-hub/plugin-utils';

import { createCatalogColumnsFunc } from '../../utils/catalog';
import getDynamicRootConfig from '../../utils/dynamicUI/getDynamicRootConfig';
import { entityPage } from '../catalog/EntityPage';
import { CustomCatalogFilters } from '../catalog/filters/CustomCatalogFilters';
import { LearningPaths } from '../learningPaths/LearningPathsPage';
import { Root } from '../Root';
import { ApplicationDrawer } from '../Root/ApplicationDrawer';
import { ApplicationListener } from '../Root/ApplicationListener';
import { ApplicationProvider } from '../Root/ApplicationProvider';
import ConfigUpdater from '../Root/ConfigUpdater';
import { SearchPage } from '../search/SearchPage';
import { settingsPage } from '../UserSettings/SettingsPages';

const AppBase = () => {
  const {
    AppProvider,
    AppRouter,
    dynamicRoutes,
    entityTabOverrides,
    providerSettings,
    scaffolderFieldExtensions,
    catalogTableColumns,
  } = useContext(DynamicRootContext);

  // Create catalog columns function based on configuration
  const catalogColumnsFunc = useMemo(
    () => createCatalogColumnsFunc(catalogTableColumns),
    [catalogTableColumns],
  );

  return (
    <AppProvider>
      <AlertDisplay />
      <OAuthRequestDialog />
      <ConfigUpdater />
      <AppRouter>
        <ApplicationProvider>
          <ApplicationListener />
          <Root>
            <FlatRoutes>
              <Route
                path="/catalog"
                element={
                  <CatalogIndexPage
                    pagination
                    columns={catalogColumnsFunc}
                    filters={<CustomCatalogFilters />}
                  />
                }
              />
              <Route
                path="/catalog/:namespace/:kind/:name"
                element={<CatalogEntityPage />}
              >
                {entityPage(entityTabOverrides)}
              </Route>
              <Route path="/create" element={<ScaffolderPage />}>
                <ScaffolderFieldExtensions>
                  {scaffolderFieldExtensions.map(
                    ({ scope, module, importName, Component }) => (
                      <Component key={`${scope}-${module}-${importName}`} />
                    ),
                  )}
                </ScaffolderFieldExtensions>
                scaffolderFieldExtensions
              </Route>
              <Route path="/api-docs" element={<ApiExplorerPage />} />

              <Route
                path="/catalog-import"
                element={
                  <RequirePermission permission={catalogEntityCreatePermission}>
                    <CatalogImportPage />
                  </RequirePermission>
                }
              />
              <Route path="/search" element={<BackstageSearchPage />}>
                <SearchPage />
              </Route>
              <Route path="/settings" element={<UserSettingsPage />}>
                {settingsPage(providerSettings)}
              </Route>
              <Route path="/catalog-graph" element={<CatalogGraphPage />} />
              <Route path="/learning-paths" element={<LearningPaths />} />
              {dynamicRoutes.map(
                ({ Component, staticJSXContent, path, config: { props } }) => {
                  return (
                    <Route
                      key={path}
                      path={path}
                      element={<Component {...props} />}
                    >
                      {typeof staticJSXContent === 'function'
                        ? staticJSXContent(getDynamicRootConfig())
                        : staticJSXContent}
                    </Route>
                  );
                },
              )}
            </FlatRoutes>
          </Root>
          <ApplicationDrawer />
        </ApplicationProvider>
      </AppRouter>
      <AutoLogout
        enabled={false}
        idleTimeoutMinutes={60}
        useWorkerTimers={false}
      />
    </AppProvider>
  );
};

export default AppBase;
