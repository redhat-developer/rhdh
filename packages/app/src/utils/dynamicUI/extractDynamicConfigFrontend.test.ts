import { MenuItem } from './extractDynamicConfig';
import {
  buildTree,
  compareMenuItems,
  getNameFromPath,
} from './extractDynamicConfigFrontend';

describe('getNameFromPath', () => {
  test.each([
    ['/', ''],
    ['/item1/page1', 'item1.page1'],
    [' /item2/page1/ ', 'item2.page1'],
    ['/item3/page1/subpage1', 'item3.page1.subpage1'],
    ['/item4/page1-info', 'item4.page1-info'],
    ['catalog', 'catalog'],
    ['/docs', 'docs'],
  ])('should return %s when input is %s', (input, expected) => {
    const result = getNameFromPath(input);
    expect(result).toBe(expected);
  });
});

describe('compareMenuItems', () => {
  it('should correctly order items based on priority', () => {
    const item1: MenuItem = {
      name: 'item1',
      title: 'Item 1',
      icon: 'icon1',
      children: [],
      priority: 1,
    };
    const item2: MenuItem = {
      name: 'item2',
      title: 'Item 2',
      icon: 'icon2',
      children: [],
      priority: 2,
    };

    expect(compareMenuItems(item1, item2)).toBeGreaterThan(0);
    expect(compareMenuItems(item2, item1)).toBeLessThan(0);
  });

  it('should treat undefined priority as 0', () => {
    const item1: MenuItem = {
      name: 'item1',
      title: 'Item 1',
      icon: 'icon1',
      children: [],
      priority: 1,
    };
    const itemWithoutPriority: MenuItem = {
      name: 'itemWithoutPriority',
      title: 'No Priority',
      icon: 'icon3',
      children: [],
    };

    expect(compareMenuItems(item1, itemWithoutPriority)).toBeLessThan(0);
    expect(compareMenuItems(itemWithoutPriority, item1)).toBeGreaterThan(0);
  });

  it('should return 0 if both priorities are equal', () => {
    const item1: MenuItem = {
      name: 'item1',
      title: 'Item 1',
      icon: 'icon1',
      children: [],
      priority: 1,
    };
    const item2: MenuItem = {
      name: 'item2',
      title: 'Item 2',
      icon: 'icon2',
      children: [],
      priority: 1,
    };

    expect(compareMenuItems(item1, item2)).toBe(0);
  });

  it('should handle both items without priority', () => {
    const item1: MenuItem = {
      name: 'item1',
      title: 'Item 1',
      icon: 'icon1',
      children: [],
    };
    const item2: MenuItem = {
      name: 'item2',
      title: 'Item 2',
      icon: 'icon2',
      children: [],
    };

    expect(compareMenuItems(item1, item2)).toBe(0);
  });
});

const createMenuItem = (
  name: string,
  title: string,
  icon: string,
  parent?: string,
  children = [],
  enabled?: boolean,
) => ({
  name,
  title,
  icon,
  parent,
  children,
  enabled: enabled,
});

describe('buildTree', () => {
  const testCases = [
    {
      description:
        'should return an empty array when given an empty menuItemsArray',
      input: [],
      expectedOutput: [],
    },
    {
      description:
        'should return a flat list of menu items if no parent-child relationship exists',
      input: [
        createMenuItem('item1', 'Item 1', 'icon1'),
        createMenuItem('item2', 'Item 2', 'icon2'),
      ],
      expectedOutput: [
        createMenuItem('item1', 'Item 1', 'icon1'),
        createMenuItem('item2', 'Item 2', 'icon2'),
      ],
    },
    {
      description:
        'should build a tree from a flat list with parent-child relationships',
      input: [
        createMenuItem('item1', 'Item 1', 'icon1'),
        createMenuItem('item2', 'Item 2', 'icon2', 'item1'),
        createMenuItem('item3', 'Item 3', 'icon3', 'item1'),
      ],
      expectedOutput: [
        {
          name: 'item1',
          title: 'Item 1',
          icon: 'icon1',
          children: [
            createMenuItem('item2', 'Item 2', 'icon2', 'item1'),
            createMenuItem('item3', 'Item 3', 'icon3', 'item1'),
          ],
        },
      ],
    },
    {
      description: 'should filter out items with enabled as false or no title',
      input: [
        createMenuItem('item1', 'Item 1', 'icon1'),
        createMenuItem('item2', '', 'icon2'),
        createMenuItem('item3', 'Item 3', 'icon3', undefined, [], false),
        createMenuItem('item4', 'Item 4', 'icon4'),
      ],
      expectedOutput: [
        createMenuItem('item1', 'Item 1', 'icon1'),
        createMenuItem('item4', 'Item 4', 'icon4'),
      ],
    },
  ];

  it.each(testCases)('$description', ({ input, expectedOutput }) => {
    const result = buildTree(input);
    expect(result).toEqual(expectedOutput);
  });
});
