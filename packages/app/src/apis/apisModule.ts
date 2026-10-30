import catalogGraphPlugin from "@backstage/plugin-catalog-graph/alpha";
import {
  ALL_RELATION_PAIRS,
  ALL_RELATIONS,
  catalogGraphApiRef,
  DefaultCatalogGraphApi,
} from "@backstage/plugin-catalog-graph";

// Custom relations from @backstage-community/plugin-catalog-backend-module-scaffolder-relation-processor
const RELATION_SCAFFOLDED_FROM = "scaffoldedFrom";
const RELATION_SCAFFOLDER_OF = "scaffolderOf";

/**
 * Catalog graph plugin with scaffolderOf/scaffoldedFrom pairs for
 * @backstage-community/plugin-catalog-backend-module-scaffolder-relation-processor.
 * Overrides api:catalog-graph in-plugin so NFS does not see a second factory
 * from pluginId: 'app' (API_FACTORY_CONFLICT).
 */
export const rhdhCatalogGraphPlugin: typeof catalogGraphPlugin =
  catalogGraphPlugin.withOverrides({
    extensions: [
      catalogGraphPlugin.getExtension("api:catalog-graph").override({
        factory(originalFactory) {
          return originalFactory({
            params: (defineParams) =>
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
