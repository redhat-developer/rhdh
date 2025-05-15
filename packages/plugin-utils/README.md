# Plugin Utils

This package provides a React context-based solution for accessing the dynamic plugin configuration in Backstage applications. It allows plugins to access mount points and other dynamic configuration without direct dependency on Scalprum.

## Installation

```bash
yarn add @internal/plugin-utils
```

## Usage

### Setup

Wrap your application with the `DynamicPluginProvider` to make the dynamic plugin configuration available to all components:

```tsx
import { DynamicRootContext } from '@internal/plugin-utils';

const RootComponent = () => {
  return (
    <DynamicRootContext.Provider value={...}>
      {/* Your children */}
     <DynamicRootContext.Provider>
  );
};
```

### Accessing Dynamic Plugin Configuration

Use the `useDynamicPlugin` hook to access the dynamic plugin configuration:

```tsx
import { useDynamicPlugin } from '@internal/plugin-utils';

const MyComponent = () => {
  // Get the dynamic plugin configuration
  const config = useDynamicPlugin();

  // Access configuration properties
  console.log('Dynamic routes:', config.dynamicRoutes);
  console.log('Menu items:', config.menuItems);
  console.log('Entity tab overrides:', config.entityTabOverrides);
  console.log('Mount points:', config.mountPoints);
  console.log('Scaffolder field extensions:', config.scaffolderFieldExtensions);

  return (
    // Your component
  );
};
```

## Types

The package provides typed interfaces for the dynamic plugin configuration:

```tsx
import {
  DynamicRootConfig,
  EntityTabOverrides,
  MountPoints,
  ResolvedDynamicRoute,
  ResolvedMountPoint,
  ResolvedScaffolderFieldExtension,
} from '@internal/plugin-utils';
```
