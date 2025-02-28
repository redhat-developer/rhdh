import {
  EntityTechdocsContent as EntityTechdocsContentBase,
  TechDocsReaderPage as TechDocsReaderPageBase,
} from "@backstage/plugin-techdocs";
import { SearchFilter, useSearch } from "@backstage/plugin-search-react";

import {
  CATALOG_FILTER_EXISTS,
  catalogApiRef,
} from "@backstage/plugin-catalog-react";

import { useApi } from "@backstage/core-plugin-api";
import { TechDocsAddons } from "@backstage/plugin-techdocs-react";
import { getTechdocsAddonComponents } from "./utils";
import { type DynamicConfig } from "./types";

export const TechDocsReaderPage = {
  element: TechDocsReaderPageBase,
  staticJSXContent: (dynamicConfig: DynamicConfig) => {
    const children = getTechdocsAddonComponents(dynamicConfig);
    return <TechDocsAddons>{children}</TechDocsAddons>;
  },
};

export const EntityTechdocsContent = {
  element: EntityTechdocsContentBase,
  staticJSXContent: (dynamicConfig: DynamicConfig) => {
    const children = getTechdocsAddonComponents(dynamicConfig);
    return <TechDocsAddons>{children}</TechDocsAddons>;
  },
};

export const TechdocsSearchFilter = () => {
  const { types } = useSearch();
  const catalogApi = useApi(catalogApiRef);

  if (!types.includes("techdocs")) {
    return null;
  }

  return (
    <SearchFilter.Select
      label="Entity"
      name="name"
      values={async () => {
        // Return a list of entities which are documented.
        const { items } = await catalogApi.getEntities({
          fields: ["metadata.name"],
          filter: {
            "metadata.annotations.backstage.io/techdocs-ref":
              CATALOG_FILTER_EXISTS,
          },
        });
        return items.map((entity) => entity.metadata.name).sort();
      }}
    />
  );
};

export const techdocsSearchType = (name: string, icon: React.ReactNode) => ({
  name,
  icon,
  value: "techdocs",
});
