import {
  createFrontendModule,
  createRouteRef,
  PageBlueprint,
} from "@backstage/frontend-plugin-api";

/**
 * Overrides the upstream catalog index page to add the RHDH "Created At"
 * column and OR-logic tag filtering.
 */
const catalogPage = PageBlueprint.make({
  params: {
    path: "/catalog",
    routeRef: createRouteRef({ aliasFor: "catalog.catalogIndex" }),
    loader: async () => {
      const { CatalogIndexPage } =
        await import("@backstage/plugin-catalog/alpha");
      const { createdAtColumnsFunc } = await import("./createdAtColumns");
      const { CustomCatalogFilters } = await import("./CustomCatalogFilters");
      return (
        <CatalogIndexPage
          pagination
          columns={createdAtColumnsFunc}
          filters={<CustomCatalogFilters />}
        />
      );
    },
  },
});

export const catalogCreatedAtModule = createFrontendModule({
  pluginId: "catalog",
  extensions: [catalogPage],
});
