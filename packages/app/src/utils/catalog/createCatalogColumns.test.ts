import { Entity } from '@backstage/catalog-model';
import { CatalogTableRow } from '@backstage/plugin-catalog';
import { EntityListContextProps } from '@backstage/plugin-catalog-react';

import {
  CatalogColumnConfig,
  createCatalogColumnsFunc,
  createCreatedAtColumn,
  createCustomColumn,
  CustomColumnConfig,
} from './createCatalogColumns';

// Mock CatalogTable
jest.mock('@backstage/plugin-catalog', () => ({
  CatalogTable: {
    defaultColumnsFunc: jest.fn(() => [
      { title: 'Name', field: 'entity.metadata.name' },
      { title: 'Owner', field: 'entity.spec.owner' },
      { title: 'Type', field: 'entity.spec.type' },
    ]),
    columns: {
      createNameColumn: jest.fn(() => ({
        title: 'Name',
        field: 'entity.metadata.name',
      })),
      createOwnerColumn: jest.fn(() => ({
        title: 'Owner',
        field: 'entity.spec.owner',
      })),
      createSpecTypeColumn: jest.fn(() => ({
        title: 'Type',
        field: 'entity.spec.type',
      })),
      createSpecLifecycleColumn: jest.fn(() => ({
        title: 'Lifecycle',
        field: 'entity.spec.lifecycle',
      })),
      createMetadataDescriptionColumn: jest.fn(() => ({
        title: 'Description',
        field: 'entity.metadata.description',
      })),
      createTagsColumn: jest.fn(() => ({
        title: 'Tags',
        field: 'entity.metadata.tags',
      })),
      createNamespaceColumn: jest.fn(() => ({
        title: 'Namespace',
        field: 'entity.metadata.namespace',
      })),
      createSystemColumn: jest.fn(() => ({
        title: 'System',
        field: 'entity.spec.system',
      })),
    },
  },
}));

const createMockEntity = (overrides: Partial<Entity> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'test-entity',
    annotations: {
      'backstage.io/createdAt': '2024-01-15T10:30:00Z',
      'custom/security-tier': 'tier-1',
    },
    ...overrides.metadata,
  },
  spec: {
    type: 'service',
    owner: 'team-a',
    team: 'Platform',
    ...overrides.spec,
  },
  ...overrides,
});

const createMockCatalogTableRow = (
  entityOverrides: Partial<Entity> = {},
): CatalogTableRow => ({
  entity: createMockEntity(entityOverrides),
  resolved: {
    name: 'test-entity',
    entityRef: 'component:default/test-entity',
    ownedByRelationsTitle: 'team-a',
    ownedByRelations: [],
    partOfSystemRelationTitle: undefined,
    partOfSystemRelations: [],
  },
});

const createMockEntityListContext = (
  kindValue?: string,
): EntityListContextProps =>
  ({
    filters: {
      kind: kindValue ? { value: kindValue } : undefined,
    },
  }) as unknown as EntityListContextProps;

describe('createCreatedAtColumn', () => {
  it('creates a column with correct title', () => {
    const column = createCreatedAtColumn();
    expect(column.title).toBe('Created At');
  });

  it('renders the createdAt annotation value', () => {
    const column = createCreatedAtColumn();
    const row = createMockCatalogTableRow();
    const result = column.render?.(row, 'row');
    expect(result).toBe('2024-01-15T10:30:00Z');
  });

  it('renders empty string for invalid date', () => {
    const column = createCreatedAtColumn();
    const row = createMockCatalogTableRow({
      metadata: {
        name: 'test',
        annotations: {
          'backstage.io/createdAt': 'invalid-date',
        },
      },
    });
    const result = column.render?.(row, 'row');
    expect(result).toBe('');
  });

  it('renders empty string when annotation is missing', () => {
    const column = createCreatedAtColumn();
    const row = createMockCatalogTableRow({
      metadata: { name: 'test', annotations: {} },
    });
    const result = column.render?.(row, 'row');
    expect(result).toBe('');
  });

  it('sorts by date correctly', () => {
    const column = createCreatedAtColumn();
    const rowA = createMockCatalogTableRow({
      metadata: {
        name: 'a',
        annotations: { 'backstage.io/createdAt': '2024-01-01T00:00:00Z' },
      },
    });
    const rowB = createMockCatalogTableRow({
      metadata: {
        name: 'b',
        annotations: { 'backstage.io/createdAt': '2024-06-01T00:00:00Z' },
      },
    });
    const result = column.customSort?.(rowA, rowB, 'row');
    expect(result).toBeLessThan(0);
  });
});

describe('createCustomColumn', () => {
  it('creates a column with correct title', () => {
    const config: CustomColumnConfig = {
      title: 'Security Tier',
      field: "metadata.annotations['custom/security-tier']",
    };
    const column = createCustomColumn(config);
    expect(column.title).toBe('Security Tier');
  });

  it('renders value from annotation path', () => {
    const config: CustomColumnConfig = {
      title: 'Security Tier',
      field: "metadata.annotations['custom/security-tier']",
    };
    const column = createCustomColumn(config);
    const row = createMockCatalogTableRow();
    const result = column.render?.(row, 'row');
    expect(result).toBe('tier-1');
  });

  it('renders value from spec path', () => {
    const config: CustomColumnConfig = {
      title: 'Team',
      field: 'spec.team',
    };
    const column = createCustomColumn(config);
    const row = createMockCatalogTableRow();
    const result = column.render?.(row, 'row');
    expect(result).toBe('Platform');
  });

  it('renders default value when field is missing', () => {
    const config: CustomColumnConfig = {
      title: 'Missing Field',
      field: 'spec.nonexistent',
      defaultValue: 'N/A',
    };
    const column = createCustomColumn(config);
    const row = createMockCatalogTableRow();
    const result = column.render?.(row, 'row');
    expect(result).toBe('N/A');
  });

  it('renders empty string when field is missing and no default', () => {
    const config: CustomColumnConfig = {
      title: 'Missing Field',
      field: 'spec.nonexistent',
    };
    const column = createCustomColumn(config);
    const row = createMockCatalogTableRow();
    const result = column.render?.(row, 'row');
    expect(result).toBe('');
  });

  it('sets width when provided', () => {
    const config: CustomColumnConfig = {
      title: 'Test',
      field: 'spec.team',
      width: 150,
    };
    const column = createCustomColumn(config);
    expect(column.width).toBe('150px');
  });

  it('is sortable by default', () => {
    const config: CustomColumnConfig = {
      title: 'Test',
      field: 'spec.team',
    };
    const column = createCustomColumn(config);
    expect(column.customSort).toBeDefined();
    expect(column.sorting).toBeUndefined();
  });

  it('disables sorting when sortable is false', () => {
    const config: CustomColumnConfig = {
      title: 'Test',
      field: 'spec.team',
      sortable: false,
    };
    const column = createCustomColumn(config);
    expect(column.sorting).toBe(false);
  });
});

describe('createCatalogColumnsFunc', () => {
  it('returns default columns plus createdAt when no config provided', () => {
    const columnsFunc = createCatalogColumnsFunc();
    const columns = columnsFunc(createMockEntityListContext());

    // Should have 3 default columns + 1 createdAt column
    expect(columns).toHaveLength(4);
    expect(columns[3].title).toBe('Created At');
  });

  it('returns default columns plus createdAt when empty config provided', () => {
    const config: CatalogColumnConfig = {};
    const columnsFunc = createCatalogColumnsFunc(config);
    const columns = columnsFunc(createMockEntityListContext());

    expect(columns).toHaveLength(4);
    expect(columns[3].title).toBe('Created At');
  });

  describe('include mode', () => {
    it('only includes specified columns', () => {
      const config: CatalogColumnConfig = {
        include: ['name', 'owner'],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      expect(columns).toHaveLength(2);
      expect(columns[0].title).toBe('Name');
      expect(columns[1].title).toBe('Owner');
    });

    it('includes createdAt when specified', () => {
      const config: CatalogColumnConfig = {
        include: ['name', 'createdAt'],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      expect(columns).toHaveLength(2);
      expect(columns[0].title).toBe('Name');
      expect(columns[1].title).toBe('Created At');
    });

    it('ignores unknown column IDs', () => {
      const config: CatalogColumnConfig = {
        include: ['name', 'unknownColumn'],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      expect(columns).toHaveLength(1);
      expect(columns[0].title).toBe('Name');
    });
  });

  describe('exclude mode', () => {
    it('excludes specified columns', () => {
      const config: CatalogColumnConfig = {
        exclude: ['createdAt'],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      // Should have 3 default columns, createdAt excluded
      expect(columns).toHaveLength(3);
      expect(columns.find(c => c.title === 'Created At')).toBeUndefined();
    });

    it('excludes multiple columns', () => {
      const config: CatalogColumnConfig = {
        exclude: ['createdAt', 'owner'],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      expect(columns).toHaveLength(2);
      expect(columns.find(c => c.title === 'Created At')).toBeUndefined();
      expect(columns.find(c => c.title === 'Owner')).toBeUndefined();
    });
  });

  describe('custom columns', () => {
    it('adds custom columns to the end', () => {
      const config: CatalogColumnConfig = {
        custom: [
          {
            title: 'Security Tier',
            field: "metadata.annotations['custom/security-tier']",
          },
        ],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      // 3 default + 1 createdAt + 1 custom
      expect(columns).toHaveLength(5);
      expect(columns[4].title).toBe('Security Tier');
    });

    it('filters custom columns by kind', () => {
      const config: CatalogColumnConfig = {
        custom: [
          {
            title: 'API Version',
            field: 'spec.definition.version',
            kind: 'API',
          },
          {
            title: 'Team',
            field: 'spec.team',
          },
        ],
      };

      // When viewing Components, API-specific column should not appear
      const columnsFunc = createCatalogColumnsFunc(config);
      const componentColumns = columnsFunc(
        createMockEntityListContext('component'),
      );
      expect(
        componentColumns.find(c => c.title === 'API Version'),
      ).toBeUndefined();
      expect(componentColumns.find(c => c.title === 'Team')).toBeDefined();

      // When viewing APIs, API-specific column should appear
      const apiColumns = columnsFunc(createMockEntityListContext('api'));
      expect(apiColumns.find(c => c.title === 'API Version')).toBeDefined();
      expect(apiColumns.find(c => c.title === 'Team')).toBeDefined();
    });

    it('supports multiple kinds for a single column', () => {
      const config: CatalogColumnConfig = {
        custom: [
          {
            title: 'Shared Column',
            field: 'spec.shared',
            kind: ['Component', 'API'],
          },
        ],
      };
      const columnsFunc = createCatalogColumnsFunc(config);

      const componentColumns = columnsFunc(
        createMockEntityListContext('component'),
      );
      expect(
        componentColumns.find(c => c.title === 'Shared Column'),
      ).toBeDefined();

      const apiColumns = columnsFunc(createMockEntityListContext('api'));
      expect(apiColumns.find(c => c.title === 'Shared Column')).toBeDefined();

      const systemColumns = columnsFunc(createMockEntityListContext('system'));
      expect(
        systemColumns.find(c => c.title === 'Shared Column'),
      ).toBeUndefined();
    });
  });

  describe('combined configuration', () => {
    it('excludes columns and adds custom columns', () => {
      const config: CatalogColumnConfig = {
        exclude: ['createdAt', 'type'],
        custom: [
          {
            title: 'Custom Field',
            field: 'spec.custom',
          },
        ],
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      // 3 default - 1 type excluded + 1 custom (createdAt also excluded)
      expect(columns).toHaveLength(3);
      expect(columns.find(c => c.title === 'Type')).toBeUndefined();
      expect(columns.find(c => c.title === 'Created At')).toBeUndefined();
      expect(columns.find(c => c.title === 'Custom Field')).toBeDefined();
    });

    it('include takes precedence over exclude', () => {
      const config: CatalogColumnConfig = {
        include: ['name', 'owner'],
        exclude: ['name'], // This should be ignored when include is specified
      };
      const columnsFunc = createCatalogColumnsFunc(config);
      const columns = columnsFunc(createMockEntityListContext());

      expect(columns).toHaveLength(2);
      expect(columns[0].title).toBe('Name');
      expect(columns[1].title).toBe('Owner');
    });
  });
});
