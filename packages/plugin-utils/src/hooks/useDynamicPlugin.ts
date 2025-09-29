import { useContext } from 'react';

import { DynamicRootContext } from '../context';
import { DynamicRootConfig } from '../types';

/** Hook to access the dynamic plugin configuration */
export function useDynamicPluginConfig(): DynamicRootConfig {
  const context = useContext(DynamicRootContext);

  if (!context) {
    throw new Error(
      'useDynamicPlugin must be used within a DynamicPluginProvider',
    );
  }

  const {
    dynamicRoutes,
    entityTabOverrides,
    mountPoints,
    menuItems,
    providerSettings,
    scaffolderFieldExtensions,
    techdocsAddons,
    translationRefs,
  } = context;

  return {
    dynamicRoutes,
    entityTabOverrides,
    mountPoints,
    menuItems,
    providerSettings,
    scaffolderFieldExtensions,
    techdocsAddons,
    translationRefs,
  };
}
