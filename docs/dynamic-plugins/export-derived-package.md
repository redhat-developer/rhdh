# Export Derived Dynamic Plugin Package

In order to be able to use dynamic plugins in the RHDH, they need to be exported as a separate package. Which is then used by the RHDH to load the plugin.
Exporting a dynamic plugin package is a process of creating a new package that contains the plugin code and its dependencies, and is ready to be used as a dynamic plugin in the RHDH.

This document describes how to export a dynamic plugin package from an existing Backstage plugin.

The exporting is done using the `plugin export` command from the `@red-hat-developer-hub/cli` package.
The most convenient way to run the command is to use `npx`:

```bash
npx @red-hat-developer-hub/cli@latest plugin export
```

This command needs to be executed in the root folder of the JavaScript package (with `package.json`) of the plugin that you want to export as a dynamic plugin.

The resulting package will be located in the `dist-dynamic` sub-folder. The name of the exported packaged is modified by adding the `-dynamic` suffix to the plugin name.

This allows packing it with `npm pack`, or publishing it to npm registry. See [Packaging Dynamic Plugins](packaging-dynamic-plugins.md) for more information on how to package and distribute dynamic plugins.

> [!NOTE]
> The derived dynamic plugin JavaScript packages should **not** be pushed to the public npm registry. They should only be published to a private npm registry.

This documentation uses `@latest` tag to ensure that the latest version of the `@red-hat-developer-hub/cli` package is used.
But you need to make sure that you are using the version of the `@red-hat-developer-hub/cli` package that is compatible with your RHDH version.
You can find the compatible versions in the [Version Matrix](./versions.md).

## Backend plugins

To be compatible with the showcase dynamic plugin support, and used as dynamic plugins, existing plugins must be based on, or compatible with, the new backend system, as well as rebuilt with a dedicated CLI command.

The new backend system standard entry point (created using `createBackendPlugin()` or `createBackendModule()`) should be exported as the default export of either the main package or of an `alpha` package (if the new backend support is still provided as `alpha` APIs). This doesn't add any additional requirement on top of the standard plugin development guidelines of the new backend system.

For a practical example of a dynamic plugin entry point built upon the new backend system, please refer to the [Backstage community plugins repository](https://github.com/backstage/community-plugins/blob/main/workspaces/3scale/plugins/3scale-backend/src/module.ts).


The dynamic export mechanism identifies private, non-backstage dependencies, and sets the `bundleDependencies` field in the `package.json` file for them, so that the dynamic plugin package can be published as a self-contained package, along with its private dependencies bundled in a private `node_modules` folder.

### Shared dependencies

During the exporting process some dependencies are marked as shared dependencies, and are expected to be provided by the main Backstage application. These dependencies are not bundled in the dynamic plugin package, but are marked as `peerDependencies` in the `package.json` file.
By default, all the `@backstage`-scoped packages are considered shared packages.

Using `--shared-package` flag you can control which packages are considered shared packages.
Shared packages are expected to be provided by the main Backstage application, and are not bundled in the dynamic plugin package.
The `--shared-package` flag can be used multiple times to specify multiple shared packages.

If plugin depends on a package that is in the `@backstage` scope, but is not provided by the main Backstage application, you can use the negation prefix `!` to specify that it should be considered as a private dependency of the dynamic plugin.

### Embedded dependencies

During the exporting process some dependencies are marked as embedded dependencies, and are bundled in the dynamic plugin package.
Embedded packages are merged into the dynamic plugin package, and their dependencies are hoisted to the top level of the dynamic plugin package.
By default, all packages with `-node` or `-common` suffix are automatically embedded in the exported plugin package.

Using `--embed-package` flag you can control which packages are embedded in the dynamic plugin package.
The `--embed-package` flag can be used multiple times to specify multiple embedded packages.

If a plugin depends on another package in the same monorepo workspace, and it doesn't follow standard naming convention (`-node`, or `-common`), you can use the `--embed-package` flag to embed it in the dynamic plugin package.

Example of exporting a dynamic plugin with shared and embedded packages:

```bash
npx @red-hat-developer-hub/cli@latest plugin export --shared-package '!/@backstage/plugin-notifications/' --embed-package @backstage/plugin-notifications-backend
```

In this example, the `@backstage/plugin-notifications` package is marked as a private dependency (not shared) and it will be bundled in the dynamic plugin package, even though it is in the `@backstage` scope.
The `@backstage/plugin-notifications-backend` package is marked as an embedded dependency, and it will be bundled in the dynamic plugin package.

## Frontend plugins

Our CLI can generate the default configuration for Scalprum on the fly. For generated defaults see logs when running `npx @red-hat-developer-hub/cli@latest plugin export`. We default to the following configuration:

```json
  ...
  "scalprum": {
    "name": "<package_name>",  // Webpack container name is the same as NPM package name without "@" symbol and "/" replaced with "."
    "exposedModules": {
      "PluginRoot": "./src/index.ts" // PluginRoot module name is the default, therefore it doesn't have to be explicitly specified later in the app-config.yaml file
    }
  },
  ...
```

//TODO document how to use a separate file for the Scalprum configuration which should be a preferred way to customize Scalprum's behavior.

However, if you want to customize Scalprum's behavior, you can do so by including additional section to the `package.json` under `scalprum` key:

```json
  ...
  "scalprum": {
    "name": "custom-package-name",
    "exposedModules": {
      "FooModuleName": "./src/foo.ts",
      "BarModuleName": "./src/bar.ts",
      ...
      // You can export multiple modules here. Each module will be exposed as a separate entrypoint in the Webpack container.
    }
  },
  ...
```

Dynamic plugins may also need to be adopted to specific Backstage needs like static JSX children for mount points and dynamic routes. These changes are strictly optional and exported symbols are incompatible with static plugins.

To include static JSX as element children with your dynamically imported component, please define an additional export as follows and use that as your dynamic plugin `importName`:

```tsx
// Used by a static plugin
export const EntityTechdocsContent = () => {...}

// Used by a dynamic plugin
export const DynamicEntityTechdocsContent = {
  element: EntityTechdocsContent,
  staticJSXContent: (
    <TechDocsAddons>
      <ReportIssue />
    </TechDocsAddons>
  ),
};
```

To include components provided by other dynamic plugins inside static JSX as element children with your dynamically imported component, you can extract them from dynamicConfig that is passed to the `staticJSXContent`:

```tsx
// Used by a static plugin
export const EntityTechdocsContent = () => {...}

// Custom function that extracts addon components from dynamic config
function getTechdocsAddonComponents(dynamicConfig: DynamicConfig) {
  const techdocsAddonsData = dynamicConfig?.techdocsAddons ?? [];
  return techdocsAddonsData.map(
    ({ scope, module, importName, Component, config }) => (
      <Component key={`${scope}-${module}-${importName}`} {...config.props} />
    ),
  );
}

// Used by a dynamic plugin
export const DynamicEntityTechdocsContent = {
  element: EntityTechdocsContent,
  staticJSXContent: (dynamicConfig: DynamicConfig) => {
    const children = getTechdocsAddonComponents(dynamicConfig);
    return <TechDocsAddons>{children}</TechDocsAddons>;
  },
};
```

Important part of the frontend dynamic plugins is its layout configuration (bindings and routes). For more information on how to configure bindings and routes, see [Frontend Plugin Wiring](frontend-plugin-wiring.md).
