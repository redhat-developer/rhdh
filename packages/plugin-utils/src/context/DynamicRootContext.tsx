import { createContext } from 'react';

import { ComponentRegistry } from '../types';

export const DynamicRootContext = createContext<ComponentRegistry>({
  AppProvider: () => null,
  AppRouter: () => null,
  dynamicRoutes: [],
  entityTabOverrides: {},
  mountPoints: {},
  menuItems: [],
  providerSettings: [],
  scaffolderFieldExtensions: [],
  techdocsAddons: [],
  translationRefs: [],
});
