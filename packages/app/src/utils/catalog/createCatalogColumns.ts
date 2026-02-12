import { TableColumn } from '@backstage/core-components';
import {
  CatalogTable,
  CatalogTableColumnsFunc,
  CatalogTableRow,
} from '@backstage/plugin-catalog';
import { EntityListContextProps } from '@backstage/plugin-catalog-react';

import {
  CatalogColumnConfig,
  CustomColumnConfig,
} from '@red-hat-developer-hub/plugin-utils';
import get from 'lodash/get';

// Re-export types for convenience
export type { CatalogColumnConfig, CustomColumnConfig };

/**
 * Mapping of column IDs to their builder functions
 * Using a more flexible type to accommodate different Backstage column builder signatures
 */
type ColumnBuilderFunc = (options?: unknown) => TableColumn<CatalogTableRow>;

type ColumnBuilderMap = {
  [key: string]: ColumnBuilderFunc;
};

/**
 * Built-in column ID mappings to CatalogTable.columns builder functions
 */
const BUILTIN_COLUMN_BUILDERS: ColumnBuilderMap = {
  name: CatalogTable.columns.createNameColumn as ColumnBuilderFunc,
  owner: CatalogTable.columns.createOwnerColumn as ColumnBuilderFunc,
  type: CatalogTable.columns.createSpecTypeColumn as ColumnBuilderFunc,
  lifecycle: CatalogTable.columns
    .createSpecLifecycleColumn as ColumnBuilderFunc,
  description: CatalogTable.columns
    .createMetadataDescriptionColumn as ColumnBuilderFunc,
  tags: CatalogTable.columns.createTagsColumn as ColumnBuilderFunc,
  namespace: CatalogTable.columns.createNamespaceColumn as ColumnBuilderFunc,
  system: CatalogTable.columns.createSystemColumn as ColumnBuilderFunc,
};

/**
 * Creates the "Created At" column based on entity annotations
 */
export function createCreatedAtColumn(): TableColumn<CatalogTableRow> {
  return {
    title: 'Created At',
    field: 'entity.metadata.annotations.backstage.io/createdAt',
    customSort: (a: CatalogTableRow, b: CatalogTableRow): number => {
      const timestampA =
        a.entity.metadata.annotations?.['backstage.io/createdAt'];
      const timestampB =
        b.entity.metadata.annotations?.['backstage.io/createdAt'];

      const dateA =
        timestampA && timestampA !== ''
          ? new Date(timestampA).toISOString()
          : '';
      const dateB =
        timestampB && timestampB !== ''
          ? new Date(timestampB).toISOString()
          : '';

      return dateA.localeCompare(dateB);
    },
    render: (data: CatalogTableRow) => {
      const date = data.entity.metadata.annotations?.['backstage.io/createdAt'];
      return !isNaN(new Date(date || '').getTime()) ? date || '' : '';
    },
  };
}

/**
 * Safely extracts a value from an entity using a field path.
 * Uses lodash get for reliable nested property access.
 *
 * Supports paths like:
 * - "metadata.name"
 * - "metadata.annotations['custom/field']"
 * - "spec.team"
 *
 * @param entity - The catalog entity to extract the value from
 * @param fieldPath - The dot-notation path to the field (supports bracket notation)
 * @returns The string value at the path, or undefined if not found
 */
function getEntityFieldValue(
  entity: CatalogTableRow['entity'],
  fieldPath: string,
): string | undefined {
  const value = get(entity, fieldPath);

  if (value === null || value === undefined) {
    return undefined;
  }

  return String(value);
}

/**
 * Creates a custom column from configuration
 */
export function createCustomColumn(
  config: CustomColumnConfig,
): TableColumn<CatalogTableRow> {
  const column: TableColumn<CatalogTableRow> = {
    title: config.title,
    field: `entity.${config.field}`,
    render: (data: CatalogTableRow) => {
      const value = getEntityFieldValue(data.entity, config.field);
      return value ?? config.defaultValue ?? '';
    },
  };

  if (config.width) {
    column.width = `${config.width}px`;
  }

  if (config.sortable !== false) {
    column.customSort = (a: CatalogTableRow, b: CatalogTableRow): number => {
      const valueA = getEntityFieldValue(a.entity, config.field) ?? '';
      const valueB = getEntityFieldValue(b.entity, config.field) ?? '';
      return valueA.localeCompare(valueB);
    };
  } else {
    column.sorting = false;
  }

  return column;
}

/**
 * Checks if a custom column should be applied to the current entity kind
 */
function shouldApplyCustomColumn(
  config: CustomColumnConfig,
  currentKind?: string,
): boolean {
  if (!config.kind) {
    return true;
  }

  if (!currentKind) {
    return true;
  }

  const kinds = Array.isArray(config.kind) ? config.kind : [config.kind];
  return kinds.some(k => k.toLowerCase() === currentKind.toLowerCase());
}

/**
 * Gets the column ID from a built-in column
 */
function getColumnId(column: TableColumn<CatalogTableRow>): string | undefined {
  // Map known column titles to their IDs
  const titleToIdMap: Record<string, string> = {
    Name: 'name',
    Owner: 'owner',
    Type: 'type',
    Lifecycle: 'lifecycle',
    Description: 'description',
    Tags: 'tags',
    Namespace: 'namespace',
    System: 'system',
    'Created At': 'createdAt',
  };

  return titleToIdMap[column.title as string];
}

/**
 * Creates the columns function based on configuration
 */
export function createCatalogColumnsFunc(
  config?: CatalogColumnConfig,
): CatalogTableColumnsFunc {
  return (entityListContext: EntityListContextProps) => {
    const currentKind = entityListContext.filters.kind?.value;

    // If no config provided, use default behavior with Created At column
    if (!config || (!config.include && !config.exclude && !config.custom)) {
      return [
        ...CatalogTable.defaultColumnsFunc(entityListContext),
        createCreatedAtColumn(),
      ];
    }

    let columns: TableColumn<CatalogTableRow>[];

    // Handle include mode - only show specified columns
    if (config.include && config.include.length > 0) {
      columns = [];
      for (const columnId of config.include) {
        if (columnId === 'createdAt') {
          columns.push(createCreatedAtColumn());
        } else if (BUILTIN_COLUMN_BUILDERS[columnId]) {
          columns.push(BUILTIN_COLUMN_BUILDERS[columnId]());
        }
      }
    } else {
      // Start with default columns + Created At
      columns = [
        ...CatalogTable.defaultColumnsFunc(entityListContext),
        createCreatedAtColumn(),
      ];

      // Handle exclude mode - remove specified columns
      if (config.exclude && config.exclude.length > 0) {
        columns = columns.filter(column => {
          const columnId = getColumnId(column);
          return !columnId || !config.exclude?.includes(columnId);
        });
      }
    }

    // Add custom columns
    if (config.custom && config.custom.length > 0) {
      for (const customConfig of config.custom) {
        if (shouldApplyCustomColumn(customConfig, currentKind)) {
          columns.push(createCustomColumn(customConfig));
        }
      }
    }

    return columns;
  };
}

export default createCatalogColumnsFunc;
