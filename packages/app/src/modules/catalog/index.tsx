import {
  createFrontendModule,
  createRouteRef,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';

/**
 * Overrides the upstream catalog index page to add the RHDH "Created At"
 * column
 */
const catalogPage = PageBlueprint.make({
  params: {
    path: '/catalog',
    routeRef: createRouteRef({ aliasFor: 'catalog.catalogIndex' }),
    loader: async () => {
      const { CatalogIndexPage } = await import('@backstage/plugin-catalog/alpha');
      const { createdAtColumnsFunc } = await import('./createdAtColumns');
      return <CatalogIndexPage pagination columns={createdAtColumnsFunc} />;
    },
  },
});

export const catalogCreatedAtModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [catalogPage],
});
