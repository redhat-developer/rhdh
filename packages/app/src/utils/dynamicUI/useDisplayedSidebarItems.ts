import { useContext } from 'react';

import DynamicRootContext from '../../components/DynamicRoot/DynamicRootContext';

export const useDisplayedSidebarItems = () => {
  const { dynamicRoutes, menuItems, mountPoints } =
    useContext(DynamicRootContext);
  const headerComponents = mountPoints['global.header/component'] ?? [];

  const headerPaths = headerComponents
    .map(({ config }) => config?.props?.to)
    .filter(Boolean);

  const displayedDynamicRoutes = dynamicRoutes?.filter(
    ({ path }) => !headerPaths.includes(path),
  );

  const displayedMenuItems = menuItems.filter(
    item => !headerPaths.includes(item.to),
  );

  return {
    showSearchBar: !headerComponents.some(
      ({ config }) => (config as any)?.type === 'search',
    ),
    displayedDynamicRoutes,
    displayedMenuItems,
  };
};
