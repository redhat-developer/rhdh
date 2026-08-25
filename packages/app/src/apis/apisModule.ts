import { WebStorage } from '@backstage/core-app-api';
import {
  configApiRef,
  discoveryApiRef,
  errorApiRef,
  fetchApiRef,
  identityApiRef,
  storageApiRef,
} from '@backstage/core-plugin-api';
import { ApiBlueprint, createFrontendModule } from '@backstage/frontend-plugin-api';
import catalogGraphPlugin from '@backstage/plugin-catalog-graph/alpha';
import {
  ALL_RELATION_PAIRS,
  ALL_RELATIONS,
  catalogGraphApiRef,
  DefaultCatalogGraphApi,
} from '@backstage/plugin-catalog-graph';
import { UserSettingsStorage } from '@backstage/plugin-user-settings';

import {
  LearningPathApiClient,
  learningPathApiRef,
} from './LearningPathApiClient';

// Custom relations from @backstage-community/plugin-catalog-backend-module-scaffolder-relation-processor
const RELATION_SCAFFOLDED_FROM = 'scaffoldedFrom';
const RELATION_SCAFFOLDER_OF = 'scaffolderOf';

const storageApi = ApiBlueprint.make({
  name: 'storage',
  params: defineParams =>
    defineParams({
      api: storageApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        errorApi: errorApiRef,
        fetchApi: fetchApiRef,
        identityApi: identityApiRef,
        configApi: configApiRef,
      },
      factory: deps => {
        const persistence =
          deps.configApi.getOptionalString('userSettings.persistence') ??
          'database';
        return persistence === 'browser'
          ? WebStorage.create(deps)
          : UserSettingsStorage.create(deps);
      },
    }),
});

const learningPathApi = ApiBlueprint.make({
  name: 'learning-path',
  params: defineParams =>
    defineParams({
      api: learningPathApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        configApi: configApiRef,
        identityApi: identityApiRef,
      },
      factory: ({ discoveryApi, configApi, identityApi }) =>
        new LearningPathApiClient({ discoveryApi, configApi, identityApi }),
    }),
});

/**
 * Catalog graph plugin with scaffolderOf/scaffoldedFrom pairs for
 * @backstage-community/plugin-catalog-backend-module-scaffolder-relation-processor.
 * Overrides api:catalog-graph in-plugin so NFS does not see a second factory
 * from pluginId: 'app' (API_FACTORY_CONFLICT).
 */
export const rhdhCatalogGraphPlugin = catalogGraphPlugin.withOverrides({
  extensions: [
    catalogGraphPlugin.getExtension('api:catalog-graph').override({
      factory(originalFactory) {
        
        return originalFactory({
          params: defineParams =>
            defineParams({
              api: catalogGraphApiRef,
              deps: {},
              factory: () =>
                new DefaultCatalogGraphApi({
                  knownRelations: [
                    ...ALL_RELATIONS,
                    RELATION_SCAFFOLDED_FROM,
                    RELATION_SCAFFOLDER_OF,
                  ],
                  knownRelationPairs: [
                    ...ALL_RELATION_PAIRS,
                    [RELATION_SCAFFOLDER_OF, RELATION_SCAFFOLDED_FROM],
                  ],
                  defaultRelationTypes: { exclude: [] },
                }),
            }),
        });
      },
    }),
  ],
});

/**
 * RHDH storage and learning-path APIs for `pluginId: 'app'`.
 * Auth APIs and SCM integrations are provided by `appAuthModule` /
 * `appIntegrationsModule` from `@red-hat-developer-hub/backstage-plugin-app-auth`
 * and `@red-hat-developer-hub/backstage-plugin-app-integrations`.
 */
export const rhdhApisModule = createFrontendModule({
  pluginId: 'app',
  extensions: [storageApi, learningPathApi],
});
