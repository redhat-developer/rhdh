import {
  CatalogTable,
  CatalogTableColumnsFunc,
  CatalogTableRow,
} from "@backstage/plugin-catalog";

export const createdAtColumnsFunc: CatalogTableColumnsFunc = (
  entityListContext,
) => [
  ...CatalogTable.defaultColumnsFunc(entityListContext),
  {
    title: "Created At",
    customSort: (a: CatalogTableRow, b: CatalogTableRow) => {
      const timestampA =
        a.entity.metadata.annotations?.["backstage.io/createdAt"];
      const timestampB =
        b.entity.metadata.annotations?.["backstage.io/createdAt"];

      const dateA =
        timestampA && timestampA !== ""
          ? new Date(timestampA).toISOString()
          : "";
      const dateB =
        timestampB && timestampB !== ""
          ? new Date(timestampB).toISOString()
          : "";

      return dateA.localeCompare(dateB);
    },
    render: (data: CatalogTableRow) => {
      const date = data.entity.metadata.annotations?.["backstage.io/createdAt"];
      return !Number.isNaN(new Date(date || "").getTime())
        ? data.entity.metadata.annotations?.["backstage.io/createdAt"]
        : "";
    },
  },
];
