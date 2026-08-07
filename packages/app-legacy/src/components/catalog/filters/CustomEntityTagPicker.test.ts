import { Entity } from '@backstage/catalog-model';

import { CustomEntityTagFilter } from './CustomEntityTagPicker';

describe('CustomEntityTagFilter', () => {
  const createMockEntity = (tags: string[] = []): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: 'test-component',
      tags,
    },
  });

  describe('constructor', () => {
    it('should initialize with values', () => {
      const filter = new CustomEntityTagFilter(['tag1', 'tag2']);
      expect(filter.values).toEqual(['tag1', 'tag2']);
    });

    it('should initialize with empty array', () => {
      const filter = new CustomEntityTagFilter([]);
      expect(filter.values).toEqual([]);
    });
  });

  describe('filterEntity', () => {
    it('should return true when no filter values are set (show all)', () => {
      const filter = new CustomEntityTagFilter([]);
      const entity = createMockEntity(['tag1', 'tag2']);

      expect(filter.filterEntity(entity)).toBe(true);
    });

    it('should return true when entity has any of the selected tags (OR logic)', () => {
      const filter = new CustomEntityTagFilter(['tag1', 'tag3']);
      const entity = createMockEntity(['tag1', 'tag2']);

      expect(filter.filterEntity(entity)).toBe(true);
    });

    it('should return false when entity has none of the selected tags', () => {
      const filter = new CustomEntityTagFilter(['tag3', 'tag4']);
      const entity = createMockEntity(['tag1', 'tag2']);

      expect(filter.filterEntity(entity)).toBe(false);
    });

    it('should return false when entity has no tags but filter has values', () => {
      const filter = new CustomEntityTagFilter(['tag1', 'tag2']);
      const entity = createMockEntity([]);

      expect(filter.filterEntity(entity)).toBe(false);
    });

    it('should return false when entity has no tags metadata', () => {
      const filter = new CustomEntityTagFilter(['tag1', 'tag2']);
      const entity: Entity = {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          name: 'test-component',
          // no tags property
        },
      };

      expect(filter.filterEntity(entity)).toBe(false);
    });

    it('should handle single tag selection', () => {
      const filter = new CustomEntityTagFilter(['tag1']);
      const entity = createMockEntity(['tag1', 'tag2', 'tag3']);

      expect(filter.filterEntity(entity)).toBe(true);
    });

    it('should handle multiple matching tags (OR logic verification)', () => {
      const filter = new CustomEntityTagFilter(['tag1', 'tag2']);
      const entityWithBothTags = createMockEntity(['tag1', 'tag2', 'tag3']);
      const entityWithOneTag = createMockEntity(['tag2', 'tag4']);
      const entityWithNoMatchingTags = createMockEntity(['tag5', 'tag6']);

      // Should return true for entities with ANY matching tags
      expect(filter.filterEntity(entityWithBothTags)).toBe(true);
      expect(filter.filterEntity(entityWithOneTag)).toBe(true);
      expect(filter.filterEntity(entityWithNoMatchingTags)).toBe(false);
    });

    it('should be case sensitive', () => {
      const filter = new CustomEntityTagFilter(['Tag1']);
      const entity = createMockEntity(['tag1']);

      expect(filter.filterEntity(entity)).toBe(false);
    });
  });

  describe('toQueryValue', () => {
    it('should return the filter values', () => {
      const values = ['tag1', 'tag2', 'tag3'];
      const filter = new CustomEntityTagFilter(values);

      expect(filter.toQueryValue()).toEqual(values);
    });

    it('should return empty array when no values', () => {
      const filter = new CustomEntityTagFilter([]);

      expect(filter.toQueryValue()).toEqual([]);
    });
  });

  describe('getCatalogFilters', () => {
    it('should return catalog filters with metadata.tags key', () => {
      const values = ['tag1', 'tag2'];
      const filter = new CustomEntityTagFilter(values);

      expect(filter.getCatalogFilters()).toEqual({
        'metadata.tags': values,
      });
    });

    it('should return catalog filters with empty array', () => {
      const filter = new CustomEntityTagFilter([]);

      expect(filter.getCatalogFilters()).toEqual({
        'metadata.tags': [],
      });
    });
  });

  describe('OR logic verification (vs AND logic)', () => {
    it('should demonstrate OR logic behavior', () => {
      // This test specifically verifies OR logic vs AND logic
      const filter = new CustomEntityTagFilter(['frontend', 'backend']);

      // Entity with only 'frontend' tag should match (OR logic)
      const frontendOnlyEntity = createMockEntity(['frontend']);
      expect(filter.filterEntity(frontendOnlyEntity)).toBe(true);

      // Entity with only 'backend' tag should match (OR logic)
      const backendOnlyEntity = createMockEntity(['backend']);
      expect(filter.filterEntity(backendOnlyEntity)).toBe(true);

      // Entity with both tags should match
      const bothTagsEntity = createMockEntity(['frontend', 'backend']);
      expect(filter.filterEntity(bothTagsEntity)).toBe(true);

      // Entity with neither tag should not match
      const noMatchEntity = createMockEntity(['database', 'api']);
      expect(filter.filterEntity(noMatchEntity)).toBe(false);
    });
  });
});
