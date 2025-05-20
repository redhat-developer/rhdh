# Plugin Utils

This package provides a React context-based solution for accessing the dynamic plugin configuration in Backstage applications. It allows plugins to access mount points and other dynamic configuration without direct dependency on Scalprum.

## Installation

```bash
yarn add @red-hat-developer-hub/plugin-utils
```

## Usage

### Setup

Use `DynamicPluginProvider` to make the dynamic plugin configuration available to all components:

```tsx
import { DynamicRootContext } from '@red-hat-developer-hub/plugin-utils';

const RootComponent = () => {
  return (
    <DynamicRootContext.Provider value={...}>
      {/* Your children */}
     <DynamicRootContext.Provider>
  );
};
```

### Accessing Dynamic Plugin Configuration

Use the `useDynamicPluginConfig` hook to access the dynamic plugin configuration:

```tsx
import { useDynamicPluginConfig } from '@red-hat-developer-hub/plugin-utils';

const MyComponent = () => {
  // Get the dynamic plugin configuration
  const config = useDynamicPluginConfig();

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

### Accessing Specific Mount Points

Use the `useMountPoints` hook to access a specific mount point by its ID:

```tsx
import { useMountPoints } from '@red-hat-developer-hub/plugin-utils';

const MyComponent = () => {
  // Get a specific mount point
  const headerNavMountPoint = useMountPoints('header-nav');

  // Access mount point properties
  console.log('Mount point component:', headerNavMountPoint.component);
  console.log('Mount point props:', headerNavMountPoint.props);

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
} from '@red-hat-developer-hub/plugin-utils';
```

## Error Handling

Both hooks provide comprehensive error handling:

- **`useDynamicPluginConfig`**: Throws an error if used outside of `DynamicPluginProvider`
- **`useMountPoints`**:
  - Throws an error if used outside of `DynamicPluginProvider`
  - Throws an error if no mount point ID is provided
  - Throws an error if the specified mount point doesn't exist

```tsx
// Example error handling
try {
  const mountPoint = useMountPoints('my-mount-point');
  // Use mount point
} catch (error) {
  console.error('Mount point not found:', error.message);
}
```
