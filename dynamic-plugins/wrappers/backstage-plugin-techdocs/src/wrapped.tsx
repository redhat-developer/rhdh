import {
  EntityTechdocsContent as EntityTechdocsContentBase,
  TechDocsReaderPage as TechDocsReaderPageBase,
} from "@backstage/plugin-techdocs";
import { TechDocsAddons } from "@backstage/plugin-techdocs-react";
import { useScalprum } from "@scalprum/react-core";
import {
  ReportIssue,
  TextSize,
} from "@backstage/plugin-techdocs-module-addons-contrib";
import { SearchFilter, useSearch } from "@backstage/plugin-search-react";

import {
  CATALOG_FILTER_EXISTS,
  catalogApiRef,
} from "@backstage/plugin-catalog-react";

import { useApi } from "@backstage/core-plugin-api";

const TechdocsAddonExtensionsWrapper = () => {
  const { api } = useScalprum();
  const techdocsExtensions = getTechdocsExensions<React.ComponentType>({
    api,
  });
  const components = techdocsExtensions.map(({ Component, config }, idx) => {
    const TypedComponent = Component as React.FunctionComponent;
    return <TypedComponent {...(config?.props ?? {})} key={idx} />;
  });
  return (
    <TechDocsAddons>
      <TextSize />
    </TechDocsAddons>
  );
};

const TechdocsAddonExtensionsWrapper2 = () => {
  const { api } = useScalprum();
  const techdocsExtensions = getTechdocsExensions<React.ComponentType>({
    api,
  });
  const components = techdocsExtensions.map(({ Component, config }, idx) => {
    const TypedComponent = Component as React.FunctionComponent;
    return <TypedComponent {...(config?.props ?? {})} key={idx} />;
  });
  return <TextSize />;
};

export const TechDocsReaderPageContent = () => {};

export const TechDocsReaderPage = {
  element: TechDocsReaderPageBase,
  // staticJSXContent: <TechdocsAddonExtensionsWrapper />,
  staticJSXContent: (
    <TechDocsAddons>
      <TechdocsAddonExtensionsWrapper2 />
    </TechDocsAddons>
  ),
  // staticJSXContent: (
  //   <TechDocsAddons>
  //     <TextSize />
  //   </TechDocsAddons>
  // ),
};

export const EntityTechdocsContent = {
  element: EntityTechdocsContentBase,
  staticJSXContent: (() => {
    // const { api } = useScalprum();
    return (
      <TechDocsAddons>
        <TextSize />
      </TechDocsAddons>
    );
  })(),
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
