import {
  FrontendConfig,
  MenuItem,
  MenuItemConfig,
} from './extractDynamicConfig';

export function getNameFromPath(path: string): string {
  const trimmedPath = path.trim();
  const noLeadingTrailingSlashes = trimmedPath.startsWith('/')
    ? trimmedPath.slice(1)
    : trimmedPath;

  const cleanedPath = noLeadingTrailingSlashes.endsWith('/')
    ? noLeadingTrailingSlashes.slice(0, -1)
    : noLeadingTrailingSlashes;

  return cleanedPath.split('/').join('.');
}

function isStaticPath(path: string): boolean {
  return !path.includes(':') && !path.includes('*');
}

export function compareMenuItems(a: MenuItem, b: MenuItem) {
  return (b.priority ?? 0) - (a.priority ?? 0);
}

function convertMenuItemsRecordToArray(
  menuItemsRecord: Record<string, MenuItemConfig>,
): MenuItem[] {
  return Object.keys(menuItemsRecord).map(
    key =>
      ({
        ...menuItemsRecord[key],
        children: [],
        name: key,
      }) as MenuItem,
  );
}

export function buildTree(menuItemsArray: MenuItem[]): MenuItem[] {
  const itemMap: Record<string, MenuItem> = {};

  menuItemsArray.forEach(item => {
    if (!itemMap[item.name]) {
      itemMap[item.name] = { ...item, children: [] };
    } else {
      itemMap[item.name] = {
        ...itemMap[item.name],
        ...item,
        children: itemMap[item.name].children,
      };
    }
  });

  const filteredItemMap = Object.fromEntries(
    Object.entries(itemMap).filter(
      ([_, item]) => item.enabled !== false && item.title,
    ),
  );

  const tree: MenuItem[] = [];
  Object.values(filteredItemMap).forEach(item => {
    if (item.parent) {
      const parentItem = itemMap[item.parent];
      if (parentItem) {
        parentItem.children.push(item);
        parentItem.children.sort(compareMenuItems);
      }
    } else {
      tree.push(item);
    }
  });

  return tree.sort(compareMenuItems);
}

export function extractMenuItems(frontend: FrontendConfig): MenuItem[] {
  const items: MenuItem[] = [];

  Object.entries(frontend).forEach(([_, customProperties]) => {
    // Process dynamicRoutes
    if (customProperties.dynamicRoutes) {
      customProperties.dynamicRoutes.forEach(dr => {
        const itemName = getNameFromPath(dr.path);
        const mi = dr.menuItem;
        if (mi && isStaticPath(dr.path)) {
          items.push({
            name: itemName,
            icon: 'icon' in mi && mi.icon ? mi.icon : '',
            title: 'text' in mi && mi.text ? mi.text : '',
            titleKey: 'textKey' in mi && mi.textKey ? mi.textKey : undefined,
            to: dr.path ?? '',
            children: [],
            enabled: 'enabled' in mi ? mi.enabled : true,
          });
        }
      });
    }

    // Process menuItems
    if (customProperties.menuItems) {
      const menuItemsArray = convertMenuItemsRecordToArray(
        customProperties.menuItems,
      );
      items.push(...menuItemsArray);
    }
  });

  return buildTree(items);
}
