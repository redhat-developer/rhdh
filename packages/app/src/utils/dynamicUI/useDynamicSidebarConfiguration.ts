import { useContext } from 'react';

import DynamicRootContext from '../../components/DynamicRoot/DynamicRootContext';

export const useDynamicSidebarConfiguration = () => {
  const { dynamicRoutes, menuItems, mountPoints } =
    useContext(DynamicRootContext);
  const headerComponents = mountPoints['global.header/component'] ?? [];
  const profileMountPoints = mountPoints['global.header/profile'] ?? [];

  return {
    showSearchBar: !headerComponents.some(
      ({ config }) => (config as any)?.type === 'search',
    ),
    showSettingsButton: !profileMountPoints.some(
      ({ config }) => (config as any)?.props.link === '/settings',
    ),
    dynamicRoutes,
    menuItems,
  };
};
