# Frontend Plugin Wiring

Compared to the backend plugins, where mount points are defined in code and consumed by the backend plugin manager, frontend plugins require additional configuration in the `app-config.yaml`. A plugin missing this configuration will not be loaded into the application and will not be displayed.

Similarly to traditional Backstage instances, there are various kinds of functionality a dynamic frontend plugin can offer:

- Full new page that declares a completely new route in the app
- Extension to existing page via router `bind`ings
- Use of mount points within the application
- Extend internal library of available icons
- Provide additional Utility APIs or replace existing ones

The overall configuration is as follows:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            dynamicRoutes: ...
            menuItems: ...
            mountPoints: ...
            routeBindings: ...
            appIcons: ...
            apiFactories: ...
            translationResources: ...
```

## Extend internal library of available icons

Backstage offers an internal catalog of system icons available across the application. This is traditionally used within Catalog items as icons for links for example. Dynamic plugins also use this catalog when fetching icons for [dynamically configured routes with sidebar navigation menu entry](#dynamic-routes). Therefore, if a plugin requires a custom icon to be used for menu item, this icon must be added to the internal icon catalog. This is done via `appIcons` configuration:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            appIcons:
              - name: fooIcon # unique icon name
                module: CustomModule # optional, same as key in `scalprum.exposedModules` key in plugin's `package.json`
                importName: FooIcon # optional, actual component name that should be rendered
```

- `name` - Unique name in the app's internal icon catalog.
- `module` - Optional. Since dynamic plugins can expose multiple distinct modules, you may need to specify which set of assets you want to access within the plugin. If not provided, the default module named `PluginRoot` is used. This is the same as the key in `scalprum.exposedModules` key in plugin's `package.json`.
- `importName` - Optional. The actual component name that should be rendered as a standalone page. If not specified the `default` export is used.

## Dynamic routes

Traditionally, [Backstage full page extensions](https://backstage.io/docs/plugins/composability/#using-extensions-in-an-app) are done within the `packages/app/src/App.tsx` file. It may look like this:

```tsx
...
  <AppRouter>
    <Root>
      <FlatRoutes>
        {/* Standard routes usually available in each Backstage instance */}
        <Route path="/catalog" element={<CatalogIndexPage />} />
        <Route path="/settings" element={<UserSettingsPage />} />
        ...
        {/* Additional routes defined by user */}
        <Route path="/my-plugin" element={<FooPluginPage />} />
        ...
      </FlatRoutes>
    </Root>
  </AppRouter>
...
```

This change is usually coupled with an extension to the main sidebar navigation, achieved by editing `packages/app/src/components/Root/Root.tsx`.

In dynamic plugins this mechanism has changed and users are no longer allowed to edit `.tsx` files. Instead, they declare their desire to expose additional routes within dynamic plugin configuration:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            dynamicRoutes: # exposes full routes
              - path: /my-plugin # unique path in the app, can override `/`
                module: CustomModule # optional, same as key in `scalprum.exposedModules` key in plugin's `package.json`
                importName: FooPluginPage # optional, actual component name that should be rendered
                menuItem: # optional, allows you to populate main sidebar navigation
                  icon: fooIcon # Backstage system icon
                  text: Foo Plugin Page # menu item text
                  enabled: false # optional, allows you to remove the menu item when set to false
                config:
                  props: ... # optional, React props to pass to the component
```

Each plugin can expose multiple routes and each route is required to define its `path` and `importName` (if it differs from the default export).

- `path` - Unique path in the app. Cannot override existing routes except the `/` home route: the main home page can be replaced via the dynamic plugins mechanism.
- `module` - Optional. Since dynamic plugins can expose multiple distinct modules, you may need to specify which set of assets you want to access within the plugin. If not provided, the default module named `PluginRoot` is used. This is the same as the key in `scalprum.exposedModules` key in plugin's `package.json`.
- `importName` - Optional. The actual component name that should be rendered as a standalone page. If not specified the `default` export is used.
- `menuItem` - This property allows users to extend the main sidebar navigation and point to their new route. It accepts the following properties:
  - `text`: The label shown to the user
  - `icon`: refers to a Backstage system icon name. See [Backstage system icons](https://backstage.io/docs/getting-started/app-custom-theme/#icons) for the list of default icons and [Extending Icons Library](#extend-internal-library-of-available-icons) to extend this with dynamic plugins.
  - `enabled`: Optional. This property allows user to remove a menuItem from sidebar when it is set to `false`.
  - `importName`: optional name of an exported `SidebarItem` component. The component will receive a `to` property as well as any properties specified in `config.props`
- `config` - An optional field which is a holder to pass `props` to a custom sidebar item

A custom `SidebarItem` offers opportunities to provide a richer user experience such as notification badges. The component should accept the following properties:

```typescript
export type MySidebarItemProps = {
  to: string; // supplied by the sidebar during rendering, this will be the path configured for the dynamicRoute
};
```

Other properties can be specified as well and configured using the `config.props` property on the dynamic route.

Here is an example configuration specifying a custom `SidebarItem` component:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          my-dynamic-plugin-package-name:
            dynamicRoutes:
              - importName: CustomPage
                menuItem:
                  config:
                    props:
                      text: Click Me!
                  importName: SimpleSidebarItem
                path: /custom_page
```

## Menu items

Order and parent-children relationship of plugin menu items which are in main sidebar navigation can be customized with menu items configuration:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            menuItems: # optional, allows you to configure plugin menu items in the main sidebar navigation
              <menu_item_name>: # unique name in the plugin menu items list
                icon: fooIcon # optional, same as `menuItem.icon` in `dynamicRoutes`
                title: Foo Plugin Page # optional, same as `menuItem.text` in `dynamicRoutes`
                priority: 10 # optional, defines the order of menu items in the sidebar
                parent: favorites # optional, defines parent-child relationships for nested menu items
                enabled: false # optional, allows you to remove the menu item when set to false
```

Up to 3 levels of nested menu items are supported.

- <menu_item_name> - A unique name in the main sidebar navigation. This can represent either a standalone menu item or a parent menu item. If it represents a plugin menu item, the name must match the corresponding path in `dynamicRoutes`. For example, if `dynamicRoutes` defines `path: /my-plugin`, the `menu_item_name` must be `my-plugin`.

  - Handling Complex Paths:
    - For simple paths like `path: /my-plugin`, the `menu_item_name` should be `my-plugin`.
    - For more complex paths, such as multi-segment paths like `path: /metrics/users/info`, the `menu_item_name` should represent the full path in dot notation (e.g., `metrics.users.info`).
    - Trailing and leading slashes in paths are ignored. For example:
      - For `path: /docs`, the `menu_item_name` should be `docs`.
      - For `path: /metrics/users`, the `menu_item_name` should be `metrics.users`.

- `icon` - Optional. Defines the icon for the menu item, which refers to a Backstage system icon. See [Backstage system icons](https://backstage.io/docs/getting-started/app-custom-theme/#icons) for the default list, or extend the icon set using dynamic plugins. RHDH also provides additional icons in its internal library. See [CommonIcons.tsx](https://github.com/redhat-developer/rhdh/blob/main/packages/app/src/components/DynamicRoot/CommonIcons.tsx) for reference. If the icon is already defined in the `dynamicRoutes` configuration under `menuItem.icon`, it can be omitted in the `menuItems` configuration.
- `title` - Optional. Specifies the display title of the menu item. This can also be omitted if it has already been defined in the `dynamicRoutes` configuration under `menuItem.text`.
- `priority` - Optional. Defines the order in which menu items appear. The default priority is `0`, which places the item at the bottom of the list. A higher priority value will position the item higher in the sidebar.
- `parent` - Optional. Defines the parent menu item to nest the current item under. If specified, the parent menu item must be defined somewhere else in the `menuItems` configuration of any enabled plugin.
- `enabled` - Optional. This property allows user to remove a menuItem from sidebar when it is set to `false`.

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>:
            dynamicRoutes:
              - path: /my-plugin
                module: CustomModule
                importName: FooPluginPage
                menuItem:
                  icon: fooIcon
                  text: Foo Plugin Page
            menuItems:
              my-plugin: # matches `path` in `dynamicRoutes`
                priority: 10 # controls order of plugins under the parent menu item
                parent: favorites # nests this plugin under the `favorites` parent menu item
              favorites: # configuration for the parent menu item
                icon: favorite # icon from RHDH system icons
                title: Favorites # title for the parent menu item
                priority: 100 # controls the order of this top-level menu item
```

## Bind to existing plugins

Another extension option available to Backstage is to [bind to the external routes](https://backstage.io/docs/plugins/composability/#binding-external-routes-in-the-app) of existing plugins. This is traditionally done via the `bindRoutes` interface as:

```tsx
createApp({
  bindRoutes({ bind }) {
    bind(barPlugin.externalRoutes, {
      headerLink: fooPlugin.routes.root,
    });
  },
});
```

Dynamic plugins offer similar functionality via `routeBindings` configuration:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            routeBindings:
              targets: # Declare a new bind target
                - name: barPlugin # Optional, defaults to importName. Explicit name of the plugin that exposes the bind target
                  importName: barPlugin # Required. Explicit import name that reference a BackstagePlugin<{}> implementation.
                  module: CustomModule # Optional, same as key in `scalprum.exposedModules` key in plugin's `package.json`
              bindings:
                - bindTarget: "barPlugin.externalRoutes" # Required. One of the supported or imported bind targets
                  bindMap: # Required. Map of bindings, same as the `bind` function options argument in the example above
                    headerLink: "fooPlugin.routes.root"
```

This configuration allows you to bind to existing plugins and their routes as well as declare new targets sourced from dynamic plugins:

1. Define new targets:
   `routeBindings.targets` allow you to define new targets. It accepts a list of targets where:
   - `importName` is required and has to resolve to a `BackstagePlugin<{}>` implementation
   - `name` is an optional argument which sets the name of the target. If not provided, `importName` is used instead.
   - `module` is an optional argument which allows you to specify which set of assets you want to access within the plugin. If not provided, the default module named `PluginRoot` is used. This is the same as the key in `scalprum.exposedModules` key in plugin's `package.json`.
2. Declare bindings:
   - `bindTarget` - Required. One of the supported or imported bind targets. This value can refer to any of the new dynamically added targets or available static targets:
     - `catalogPlugin.externalRoutes`
     - `catalogImportPlugin.externalRoutes`
     - `techdocsPlugin.externalRoutes`
     - `scaffolderPlugin.externalRoutes`

- `bindMap`: Required. Map of bindings, same as the `bind` function options argument in the traditional Backstage example above

## Using mount points

Mount points are defined identifiers available across the application. These points specifically allow users to extend existing pages with additional content.

### Customizing Entity page

This section aims to allow users dynamic extension of [Catalog Components](https://backstage.io/docs/plugins/composability/#catalog-components), but can be used to extend additional views in the future as well.

The following mount points are available:

| Mount point                  | Description                         | Visible even when no plugins are enabled                       |
| ---------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `admin.page.plugins`         | Administration plugins page         | NO                                                             |
| `admin.page.rbac`            | Administration RBAC page            | NO                                                             |
| `entity.context.menu`        | Catalog entity context menu         | YES for all entities                                           |
| `entity.page.overview`       | Catalog entity overview page        | YES for all entities                                           |
| `entity.page.topology`       | Catalog entity "Topology" tab       | NO                                                             |
| `entity.page.issues`         | Catalog entity "Issues" tab         | NO                                                             |
| `entity.page.pull-requests`  | Catalog entity "Pull Requests" tab  | NO                                                             |
| `entity.page.ci`             | Catalog entity "CI" tab             | NO                                                             |
| `entity.page.cd`             | Catalog entity "CD" tab             | NO                                                             |
| `entity.page.kubernetes`     | Catalog entity "Kubernetes" tab     | NO                                                             |
| `entity.page.image-registry` | Catalog entity "Image Registry" tab | NO                                                             |
| `entity.page.monitoring`     | Catalog entity "Monitoring" tab     | NO                                                             |
| `entity.page.lighthouse`     | Catalog entity "Lighthouse" tab     | NO                                                             |
| `entity.page.api`            | Catalog entity "API" tab            | YES for entity of `kind: Component` and `spec.type: 'service'` |
| `entity.page.dependencies`   | Catalog entity "Dependencies" tab   | YES for entity of `kind: Component`                            |
| `entity.page.docs`           | Catalog entity "Documentation" tab  | YES for entity that satisfies `isTechDocsAvailable`            |
| `entity.page.definition`     | Catalog entity "Definitions" tab    | YES for entity of `kind: Api`                                  |
| `entity.page.diagram`        | Catalog entity "Diagram" tab        | YES for entity of `kind: System`                               |
| `search.page.types`          | Search result type                  | YES, default catalog search type is available                  |
| `search.page.filters`        | Search filters                      | YES, default catalog kind and lifecycle filters are visible    |
| `search.page.results`        | Search results content              | YES, default catalog search is present                         |

Mount points within Catalog aka `entity.page.*` are rendered as tabs. They become visible only if at least one plugin contributes to them, or they can render static content (see column 3 in previous table).

Each `entity.page.*` mount point has 2 complementary variations:

- `*/context` type that serves to create React contexts
- `*/cards` type for regular React components

Here is an example of the overall configuration structure of a mount point:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            mountPoints: # optional, uses existing mount points
              - mountPoint: <mountPointName>/[cards|context]
                module: CustomModule # optional, same as key in `scalprum.exposedModules` key in plugin's `package.json`
                importName: FooPluginPage # actual component name that should be rendered
                config: # optional, allows you to pass additional configuration to the component
                  layout: {} # accepts MUI sx properties
                  if: # Set of conditions that must be met for the component to be rendered
                    allOf|anyOf|oneOf:
                      - isMyPluginAvailable # an imported function from the same `module` within the plugin returns boolean
                      - isKind: component # Check if the entity is of a specific kind
                      - isType: service # Check if the entity is of a specific type
                      - hasAnnotation: annotationKey # Check if the entity has a specific annotation key
                  props: {} # React props to pass to the component
```

Each mount point supports additional configuration:

- `layout` - Used only in `*/cards` type which renders visible content. Allows you to pass MUI sx properties to the component. This is useful when you want to control the layout of the component. `entity.page.*` mount points are rendered as CSS grid, so SX property allows you to control the grid layout and exact positioning of the rendered component.
- `props` - React props passed to the component. This is useful when you want to pass some additional data to the component.
- `if` - Used only in `*/cards` type which renders visible content. This is passed to `<EntitySwitch.Case if={<here>}`.

  The following conditions are available:

  - `allOf`: All conditions must be met
  - `anyOf`: At least one condition must be met
  - `oneOf`: Only one condition must be met

  Conditions can be:

  - `isKind`: Accepts a string or a list of string with entity kinds. For example `isKind: component` will render the component only for entity of `kind: Component`.
  - `isType`: Accepts a string or a list of string with entity types. For example `isType: service` will render the component only for entities of `spec.type: 'service'`.
  - `hasAnnotation`: Accepts a string or a list of string with annotation keys. For example `hasAnnotation: my-annotation` will render the component only for entities that have `metadata.annotations['my-annotation']` defined.
  - Condition imported from the plugin's `module`: Must be function name exported from the same `module` within the plugin. For example `isMyPluginAvailable` will render the component only if `isMyPluginAvailable` function returns `true`. The function must have the following signature: `(e: Entity) => boolean`

The entity page also supports adding more items to the context menu at the top right of the page. Components targeting the `entity.context.menu` mount point have some constraints to follow. The exported component should be some form of dialog wrapper component that accepts an `open` boolean property and an `onClose` event handler property, like so:

```typescript
export type SimpleDialogProps = {
  open: boolean;
  onClose: () => void;
};
```

The context menu entry can be configured via the `props` configuration entry for the mount point. The `title` and `icon` properties will set the menu item's text and icon. Any system icon or icon added via a dynamic plugin can be used. Here is an example configuration:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          my-dynamic-plugin-package:
            appIcons:
              - name: dialogIcon
                importName: DialogIcon
            mountPoints:
              - mountPoint: entity.context.menu
                importName: SimpleDialog
                config:
                  props:
                    title: Open Simple Dialog
                    icon: dialogIcon
```

### Adding application header

The frontend system enables users to customize global headers by specifying configurations in the `app-config.yaml` file. Below is an example configuration:

```yaml
# app-config.yaml
dynamicPlugins:
  frontend:
    <package_name>: # e.g., preinstalled plugin `red-hat-developer-hub.backstage-plugin-global-header`
      mountPoints:
        - mountPoint: application/header # mount point for a global header
          importName: <header_component> # e.g., `GlobalHeader` for `red-hat-developer-hub.backstage-plugin-global-header`
          config:
            position: above-main-content # options: `above-main-content` or `above-sidebar`
```

Each global header entry requires the following attributes:

- `mountPoint`: Defines where the header will be added. Use `application/header` to specify it as a global header.
- `importName`: Specifies the component exported by the global header plugin (e.g., `GlobalHeader`).
- `config.position`: Determines the header's position. Supported values are:
  - `above-main-content`: Positions the header above the main content area.
  - `above-sidebar`: Positions the header above the sidebar.

Users can configure multiple global headers at different positions by adding entries to the `mountPoints` field.

### Adding application listeners

The users can add application listeners using the `application/listener` mount point. Below is an example that uses the aforesaid mount point:

```yaml
# app-config.yaml
dynamicPlugins:
  frontend:
    <package_name>: # plugin_package_name same as `scalprum.name` key in plugin's `package.json`
      mountPoints:
        - mountPoint: application/listener
          importName: <exported listener component>
```

Users can configure multiple application listeners by adding entries to the `mountPoints` field.

### Adding application providers

The users can add application providers using the `application/provider` mount point. Below is an example that uses the aforesaid mount point to configure a context provider:

```yaml
# app-config.yaml
dynamicPlugins:
  frontend:
    <package_name>: # plugin_package_name same as `scalprum.name` key in plugin's `package.json`
      dynamicRoutes:
        - path: /<route>
          importName: Component # Component you want to load on the route
      mountPoints:
        - mountPoint: application/provider
          importName: <exported provider component>
```

Users can configure multiple application providers by adding entries to the `mountPoints` field.

## Customizing and Adding Entity tabs

Out of the box the frontend system provides an opinionated set of tabs for catalog entity views. This set of tabs can be further customized and extended as needed via the `entityTabs` configuration:

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            entityTabs:
              # Adding a new tab
              - path: /new-path
                title: My New Tab
                mountPoint: entity.page.my-new-tab
              # Change an existing tab's title or mount point
              - path: /
                title: General
                mountPoint: entity.page.overview #this can be customized too
              # Prioritizing tabs (higher priority appears first)
              - path: "/pr"
                title: "Changed Pull/Merge Requests"
                priority: 1 # Added priority field
                mountPoint: "entity.page.pull-requests"
              # Negative priority hides default tabs
              - path: "/"
                title: "Changed Overview"
                mountPoint: "entity.page.overview"
                priority: -6
```

Each entity tab entry requires the following attributes:

- `path`: Specifies the sub-path route in the catalog where this tab will be available
- `title`: The title that is displayed to the user
- `mountPoint`: The base mount point name that will be available on the tab. This name will be expanded to create two mount points per tab, one appended with `/context` and the second appended with `/cards`.
- `priority` **(optional)**: Determines the order of tabs. **Tabs with higher priority values appear first** . You can set a **negative priority to hide default tabs**. If priority is omitted , no special ordering is applied.

Dynamic frontend plugins can then be configured to target the mount points exposed by the `entityTabs` configuration.

Here are the default catalog entity routes in the default order:

| Route             | Title               | Mount Point                  | Entity Kind                          |
| ----------------- | ------------------- | ---------------------------- | ------------------------------------ |
| `/`               | Overview            | `entity.page.overview`       | Any                                  |
| `/topology`       | Topology            | `entity.page.topology`       | Any                                  |
| `/issues`         | Issues              | `entity.page.issues`         | Any                                  |
| `/pr`             | Pull/Merge Requests | `entity.page.pull-requests`  | Any                                  |
| `/ci`             | CI                  | `entity.page.ci`             | Any                                  |
| `/cd`             | CD                  | `entity.page.cd`             | Any                                  |
| `/kubernetes`     | Kubernetes          | `entity.page.kubernetes`     | Any                                  |
| `/image-registry` | Image Registry      | `entity.page.image-registry` | Any                                  |
| `/monitoring`     | Monitoring          | `entity.page.monitoring`     | Any                                  |
| `/lighthouse`     | Lighthouse          | `entity.page.lighthouse`     | Any                                  |
| `/api`            | Api                 | `entity.page.api`            | `kind: Service` or `kind: Component` |
| `/dependencies`   | Dependencies        | `entity.page.dependencies`   | `kind: Component`                    |
| `/docs`           | Docs                | `entity.page.docs`           | Any                                  |
| `/definition`     | Definition          | `entity.page.definition`     | `kind: API`                          |
| `/system`         | Diagram             | `entity.page.diagram`        | `kind: System`                       |

The visibility of a tab is derived from the kind of entity that is being displayed along with the visibility guidance mentioned in "[Using mount points](#using-mount-points)".

## Translation resources

Users can add translation resources exported by plugin packages in the plugin's dynamic configuration

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # same as `scalprum.name` key in plugin's `package.json`
            translationResources:
              # Adding the exported translations
              - importName: <plugin translation>
```

Users can override default translations of a plugin with their own JSON-based translations

```yaml
# dynamic-plugins-config.yaml
plugins:
  - plugin: <plugin_path_or_url>
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          <package_name>: # must match the `scalprum.name` key in plugin's `package.json`
            translationResources:
              # Adding the exported translations for this plugin
              - importName: <plugin translation>
                ref: <plugin translation ref> # Ref is required for `jsonTranslations`
```

## Provide additional Utility APIs

Backstage offers a Utility API mechanism that provide ways for plugins to communicate during their entire life cycle. Utility APIs are registered as:

- Core APIs, which are always present in any Backstage application
- Custom plugin-made API that can be already self-contained within any plugin (including dynamic plugins)
- [App API implementations and overrides](https://backstage.io/docs/api/utility-apis/#app-apis) which needs to be added separately.

and a plugin can potentially expose multiple API Factories. Dynamic plugins allow a couple different ways to take advantage of this functionality.

If a dynamic plugin exports the plugin object returned by `createPlugin`, it will be supplied to the `createApp` API and all API factories exported by the plugin will be automatically registered and available in the frontend application. Dynamic plugins that follow this pattern should not use the `apiFactories` configuration. Also, if a dynamic plugin only contains API factories and follows this pattern, it will just be necessary to add an entry to the `dynamicPlugins.frontend` config for the dynamic plugin package name, for example:

```yaml
# app-config.yaml
dynamicPlugins:
  frontend:
    my-dynamic-plugin-package-with-api-factories: {}
```

However, if the dynamic plugin doesn't export it's plugin object then it will be necessary to explicitly configure each API factory that should be registered with the `createApp` API via the `apiFactories` configuration:

```yaml
# app-config.yaml
dynamicPlugins:
  frontend:
    <package_name>: # same as `scalprum.name` key in plugin's `package.json`
      apiFactories:
        - importName: BarApi # Optional, explicit import name that reference a AnyApiFactory<{}> implementation. Defaults to default export.
          module: CustomModule # Optional, same as key in `scalprum.exposedModules` key in plugin's `package.json`
```

- `importName` is an optional import name that reference a `AnyApiFactory<{}>` implementation. Defaults to `default` export.
- `module` is an optional argument which allows you to specify which set of assets you want to access within the plugin. If not provided, the default module named `PluginRoot` is used. This is the same as the key in `scalprum.exposedModules` key in plugin's `package.json`.

There are a set of [API factories](https://github.com/redhat-developer/rhdh/blob/main/packages/app/src/apis.ts) already initialized by the Developer Hub application shell. These API factories can be overridden by an API factory provided by a dynamic plugin by specifying the same API ref ID, for example a dynamic plugin could export the following `AnyApiFactory<{}>` to cater for some specific use case:

```typescript
export const customScmAuthApiFactory = createApiFactory({
  api: scmAuthApiRef,
  deps: { githubAuthApi: githubAuthApiRef },
  factory: ({ githubAuthApi }) =>
    ScmAuth.merge(
      ScmAuth.forGithub(githubAuthApi, { host: "github.someinstance.com" }),
      ScmAuth.forGithub(githubAuthApi, {
        host: "github.someotherinstance.com",
      }),
    ),
});
```

And the corresponding YAML configuration would look like:

```yaml
dynamicPlugins:
  frontend:
    <package_name>:
      apiFactories:
        - importName: customScmAuthApiFactory
```

which would override the default `ScmAuth` API factory that Developer Hub defaults to.

## Adding custom authentication provider settings

Out of the box the Backstage user settings page supports all of the documented authentication providers, such as "github" or "microsoft". However it is possible to install new authentication providers from a dynamic plugin that either adds additional configuration support for an existing provider or adds a new authentication provider altogether. In either case, these providers are normally listed in the user settings section of the app under the "Authentication Providers" tab. To add entries for an authentication provider from a dynamic plugin, use the `providerSettings` configuration:

```yaml
dynamicPlugins:
  frontend:
    <package_name>:
      providerSettings:
        - title: My Custom Auth Provider
          description: Sign in using My Custom Auth Provider
          provider: core.auth.my-custom-auth-provider
```

Each provider settings entry should define the following attributes:

- `title`: The title for the authentication provider shown above the user's profile image if available.
- `description`: a short description of the authentication provider.
- `provider`: The ID of the authentication provider as provided to the `createApiRef` API call. This value is used to look up the corresponding API factory for the authentication provider to connect the provider's Sign In/Sign Out button.

## Use a custom SignInPage component

In a Backstage app the SignInPage component is used to connect one or more authentication providers to the application sign-in process. Out of the box in Developer Hub a static SignInPage is already set up and supports all of the built-in authentication providers already. To use a different authentication provider, for example from a dynamic plugin use the `signInPage` configuration:

```yaml
dynamicPlugins:
  frontend:
    <package_name>:
      signInPage:
        importName: CustomSignInPage
```

Only one `signInPage` is specified and used by the application, this configuration object supports the following properties:

- `module`: optional setting to specify which set of assets should be accessed from the dynamic plugin, defaults to `PluginRoot`
- `importName`: Required setting that should resolve to a component that returns a configured `SignInPage` component that connects the appropriate authentication provider factories, or a compatible custom implementation.

## Provide custom Scaffolder field extensions

The Backstage scaffolder component supports specifying [custom form fields](https://backstage.io/docs/features/software-templates/writing-custom-field-extensions/#creating-a-field-extension) for the software template wizard, for example:

```typescript
export const MyNewFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: "MyNewFieldExtension",
    component: MyNewField,
    validation: myNewFieldValidator,
  }),
);
```

These components can be contributed by plugins by exposing the scaffolder field extension component via the `scaffolderFieldExtensions` configuration:

```yaml
dynamicPlugins:
  frontend:
    <package_name>: # same as `scalprum.name` key in plugin's `package.json`
      scaffolderFieldExtensions:
        - importName: MyNewFieldExtension
```

A plugin can specify multiple field extensions, in which case each field extension will need to supply an `importName` for each field extension.

- `importName` is an optional import name that should reference the value returned the scaffolder field extension API
- `module` is an optional argument which allows you to specify which set of assets you want to access within the plugin. If not provided, the default module named `PluginRoot` is used. This is the same as the key in `scalprum.exposedModules` key in plugin's `package.json`.

## Provide custom TechDocs addons

The Backstage TechDocs component supports specifying [custom addons](https://backstage.io/docs/features/techdocs/addons/) to extend TechDocs functionality, like rendering a component or accessing and manipulating TechDocs's DOM.

Here is an example of creating an addon:

```typescript
export const ExampleAddon = techdocsPlugin.provide(
  createTechDocsAddonExtension({
    name: "ExampleAddon",
    location: TechDocsAddonLocations.Content,
    component: ExampleTestAddon,
  }),
);
```

These components can be contributed by plugins by exposing the TechDocs addon component via the `techdocsAddons` configuration:

```yaml
dynamicPlugins:
  frontend:
    <package_name>: # same as `scalprum.name` key in plugin's `package.json`
      techdocsAddons:
        - importName: ExampleAddon
          config:
            props: ... # optional, React props to pass to the addon
```

A plugin can specify multiple addons, in which case each techdocsAddon will need to supply an `importName` for each addon.

- `importName` name of an exported `Addon` component
- `module` is an optional argument which allows you to specify which set of assets you want to access within the plugin. If not provided, the default module named `PluginRoot` is used. This is the same as the key in `scalprum.exposedModules` key in plugin's `package.json`.

## Add a custom Backstage theme or replace the provided theme

The look and feel of a Backstage application is handled by Backstage theming. Out of the box Developer Hub provides a theme with a number of [configuration overrides](../customization.md) that allow for user customization. It's also possible to provide additional Backstage themes as well as replace the out of box Developer Hub themes from a dynamic plugin.

A dynamic plugin would export a theme provider function with a signature of `({ children }: { children: ReactNode }): React.JSX.Element`, for example:

```typescript
import { lightTheme } from './lightTheme';
import { darkTheme } from './darkTheme';
import { UnifiedThemeProvider } from '@backstage/theme';

export const lightThemeProvider = ({ children }: { children: ReactNode }) => (
  <UnifiedThemeProvider theme={lightTheme} children={children} />
);

export const darkThemeProvider = ({ children }: { children: ReactNode }) => (
  <UnifiedThemeProvider theme={darkTheme} children={children} />
);
```

And then the theme can be declared via the `themes` configuration:

```yaml
dynamicPlugins:
  frontend:
    <package_name>: # same as `scalprum.name` key in a plugins `package.json`
      themes:
        - id: light # Using 'light' overrides the app-provided light theme
          title: Light
          variant: light
          icon: someIconReference
          importName: lightThemeProvider
        - id: dark # Using 'dark' overrides the app-provided dark theme
          title: Dark
          variant: dark
          icon: someIconReference
          importName: darkThemeProvider
```

The required options mirror the [AppTheme](https://backstage.io/docs/reference/core-plugin-api.apptheme/) interface:

- `id` A required ID value for the theme; use values of `light` or `dark` to replace the default provided themes.
- `title` The theme name displayed to the user on the Settings page.
- `variant` Whether the theme is `light` or `dark`, can only be one of these values.
- `icon` a string reference to a system or [app icon](#extend-internal-library-of-available-icons)
- `importName` name of the exported theme provider function, the function signature should match `({ children }: { children: ReactNode }): React.JSX.Element`
