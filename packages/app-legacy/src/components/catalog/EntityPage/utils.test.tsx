import { defaultTabs } from './defaultTabs';
import { mergeTabs } from './utils';

describe('mergeTabs', () => {
  it('should return defaultTabs when no overrides are provided', () => {
    const result = mergeTabs({});
    const expected = Object.entries(defaultTabs);
    expect(result).toEqual(expected);
  });

  it('should merge entityTabOverrides with defaultTabs', () => {
    const overrides = {
      '/docs': {
        title: 'My Documentation',
        mountPoint: 'entity.page.docs',
        priority: 2,
      },
    };
    const result = mergeTabs(overrides);
    expect(result).toContainEqual(['/docs', overrides['/docs']]);
  });

  it('should remove tabs with negative priority', () => {
    const overrides = {
      '/ci': { ...defaultTabs['/ci'], priority: -1 },
    };
    const result = mergeTabs(overrides);
    expect(result.find(([key]) => key === '/ci')).toBeUndefined();
  });

  it('should sort tabs based on priority', () => {
    const overrides = {
      '/docs': { ...defaultTabs['/docs'], priority: 5 },
      '/topology': {
        title: 'New Topology',
        mountPoint: 'entity.page.topology',
        priority: 10,
      },
    };
    const result = mergeTabs(overrides);
    expect(result[0][0]).toBe('/topology');
    expect(result[1][0]).toBe('/docs');
  });
});
