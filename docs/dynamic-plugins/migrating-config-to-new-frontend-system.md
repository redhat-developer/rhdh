# Migrating RHDH Frontend Configuration to the Backstage New Frontend System

This guide helps **operators and platform administrators** customize Red Hat Developer Hub (RHDH) after it moves to the **Backstage new frontend system**. It explains how to translate legacy RHDH frontend configuration (`dynamicPlugins.frontend` in `dynamic-plugins.yaml` and related `app-config`) into the upstream `app.*` configuration model.

> **Operators / platform admins** → this document.
>
> **Plugin authors** → [Migrating Plugins to the New Frontend System](migrating-plugins-to-new-frontend-system.md).

## Transition: the new frontend system is not the default yet

RHDH still ships the legacy `app` frontend package by default. The new frontend system lives in the `app-next` package and will become the default after the app-shell switch. Until then, enable **both** of the following on your RHDH **backend** deployment (OpenShift, Helm, Operator, [rhdh-local](https://github.com/redhat-developer/rhdh-local), or any environment where the backend runs as a container):

| Setting | How to apply | Purpose |
| --- | --- | --- |
| `app.packageName: app-next` | Environment variable `APP_CONFIG_app_packageName=app-next`, **or** in `app-config.yaml` under `app.packageName` | Tells the app backend to serve the `app-next` frontend (new frontend system) instead of `app`. |
| `ENABLE_STANDARD_MODULE_FEDERATION=true` | Environment variable on the backend container only | Enables the backend to serve standard Module Federation assets for dynamic frontend plugins. Without this, RHDH disables that service because the legacy frontend does not use it. |

Example environment variables for the RHDH backend pod or deployment:

```bash
APP_CONFIG_app_packageName=app-next
ENABLE_STANDARD_MODULE_FEDERATION=true
```

Equivalent `app-config` fragment (you still need `ENABLE_STANDARD_MODULE_FEDERATION` in the environment):

```yaml
app:
  packageName: app-next
```

These requirements are temporary. Once RHDH completes the switch to `app-next`, they will become the default and this transition note can be removed.

## Who should read this

- RHDH administrators who edit `dynamic-plugins.yaml`, Helm values, or Operator configuration.
- Customer solution architects who customized entity tabs, mount points, routes, or navigation through YAML.
- Anyone familiar with [Frontend Plugin Wiring](frontend-plugin-wiring.md) who needs the equivalent settings in the new frontend system.

## Prerequisites

- RHDH is running with the new frontend system enabled — see [Transition: the new frontend system is not the default yet](#transition-the-new-frontend-system-is-not-the-default-yet) above.
- You understand where your deployment stores `dynamic-plugins.yaml` and `app-config` — see [Installing Plugins](installing-plugins.md) and the [Red Hat product documentation](https://docs.redhat.com/en/documentation/red_hat_developer_hub/) for Helm and Operator paths.
- Installed plugins support the new frontend system. Configuration alone cannot add UI that a plugin does not register as an extension.

## The mindset shift

| Aspect | Legacy RHDH (`dynamicPlugins.frontend`) | New frontend system (`app.*`) |
| --- | --- | --- |
| Who declares UI placement | **You** in YAML (`mountPoints`, `dynamicRoutes`, `importName`) | **Plugins** declare defaults; you **override** via config |
| Plugin registration | Per-plugin block under `dynamicPlugins.frontend` | Plugin installed + auto-discovered; `app.packages` controls discovery |
| Entity cards | `mountPoints` on `entity.page.*` | `entity-card:*` extensions on overview |
| Entity tabs | `entityTabs` + mount point names | `entity-content:*` extensions + `page:catalog/entity` groups |
| Cross-plugin links | `routeBindings` | `app.routes.bindings` |
| Disable a feature | Remove YAML or set `enabled: false` | `app.extensions: [<extension-id>: false]` |
| Ordering | List order in `mountPoints` / `entityTabs` | List order in `app.extensions` |

**Key idea:** In the legacy model, you told RHDH *which exported component goes to which mount point*. In the new frontend system, plugins describe their own extensions; you enable, disable, reorder, and tune them through `app.extensions`, `app.routes.bindings`, and related `app.*` keys.

## Who does what

| Responsibility | Operator (this guide) | Plugin vendor |
| --- | --- | --- |
| Install / enable a plugin | `dynamic-plugins.yaml` `enabled: true` | Publish OCI or npm package |
| Add a new entity tab | Configure an existing `entity-content:*` extension | Plugin update (see [plugins migration guide](migrating-plugins-to-new-frontend-system.md)) |
| Add a card to entity overview | Enable/configure `entity-card:*` | Plugin update (see [plugins migration guide](migrating-plugins-to-new-frontend-system.md)) |
| Hide a default card or page | `app.extensions: [<id>: false]` | — |
| Change tab title or group | `entity-content:*` or `page:catalog/entity` config | Sensible defaults in plugin |
| Replace entire settings page | `page:user-settings` override (limited today) | Full page extension |

If a customization required `mountPoints` + `importName` before, the plugin must now expose that UI as an extension. Contact the plugin maintainer if the extension does not appear after install.

## Where configuration lives in RHDH

RHDH still uses two related configuration surfaces:

### `dynamic-plugins.yaml` — plugin installation

Defines **which** dynamic plugins are installed and whether they are enabled. Each entry can include `pluginConfig`, which is merged into `app-config.dynamic-plugins.yaml` at startup.

```yaml
plugins:
  - enabled: true
    package: oci://example.com/my-plugin:1.0
    pluginConfig:
      # Fragment merged into app-config
```

See [Installing Plugins](installing-plugins.md) for Helm, Operator, and catalog index image details.

### `app-config` — application behavior

Frontend customization for the new frontend system lives under top-level `app` keys in `app-config.yaml` (or fragments merged into it):

| Key | Purpose |
| --- | --- |
| `app.packages` | Control automatic discovery of frontend plugins from dependencies |
| `app.routes.bindings` | Bind external route references between plugins |
| `app.extensions` | Enable, disable, reorder, and configure individual extensions |
| `app.pluginOverrides` | Override resolved plugin metadata (owner, description, etc.) |

Default plugin configuration may also come from the catalog index image (`dynamic-plugins.default.yaml`). You can override defaults in your own `dynamic-plugins.yaml` `pluginConfig` or in `app-config`.

### Config file merging

Backstage merges configuration files by **replacing entire arrays** when the same key appears in multiple files. If `app.extensions` is defined in both `app-config.yaml` and `app-config.production.yaml`, the higher-priority file's array **replaces** the lower-priority one — entries are not merged entry-by-entry.

Because unlisted extensions are still **auto-discovered**, a local override file can contain only the extensions you want to change:

```yaml
# app-config.local.yaml — only overrides what you need
app:
  extensions:
    - entity-card:catalog/about:
        config:
          type: info
```

Individual extension `config` objects are also replaced wholesale when overridden. See [Writing Configuration](https://backstage.io/docs/conf/writing/) and [Configuring Extensions](https://backstage.io/docs/frontend-system/building-apps/configuring-extensions/).

---

## Configuration surface overview

### `app.packages`

Controls which frontend plugin packages are auto-discovered at build time:

```yaml
app:
  packages: all
```

Or restrict explicitly:

```yaml
app:
  packages:
    include:
      - '@backstage/plugin-catalog'
      - '@backstage/plugin-techdocs'
    exclude: []
```

Dynamic plugins loaded at runtime through the frontend feature loader are discovered separately from this setting; consult your RHDH release notes for how installed OCI plugins participate in extension discovery.

### `app.routes.bindings`

Replaces `routeBindings` in `dynamicPlugins.frontend`:

```yaml
# Legacy RHDH
dynamicPlugins:
  frontend:
    backstage.plugin-techdocs:
      routeBindings:
        targets:
          - importName: techdocsPlugin
        bindings:
          - bindTarget: catalogPlugin.externalRoutes
            bindMap:
              viewTechDoc: techdocsPlugin.routes.docRoot
```

```yaml
# New frontend system
app:
  routes:
    bindings:
      catalog.viewTechDoc: techdocs.docRoot
      catalog.createComponent: scaffolder.index
      scaffolder.registerComponent: false  # explicitly disable a binding
```

Binding values use `pluginId.routeName` syntax. See [Frontend Routes](https://backstage.io/docs/frontend-system/architecture/routes/#binding-external-route-references).

### `app.extensions`

List of extension IDs with optional `attachTo`, `disabled`, and `config`:

```yaml
app:
  extensions:
    # Shorthand: enable with plugin defaults
    - entity-card:catalog/about

    # Shorthand: disable
    - page:catalog-unprocessed-entities: false

    # Full form
    - entity-card:catalog/links:
        config:
          filter:
            kind: component
            metadata.links:
              $exists: true
          type: info
```

Extension IDs follow `[<kind>:]<namespace>[/<name>]` — for example `page:catalog`, `entity-card:catalog/about`, `entity-content:techdocs`.

**Resolution rules:**

1. All extensions from installed plugins are **auto-discovered** and loaded by default.
2. Entries in `app.extensions` **override** matching extensions by ID.
3. Extensions **listed** in `app.extensions` are **reordered** to appear first, in list order. Unlisted extensions keep their default order afterward.

You typically list only extensions you want to customize, disable, or reorder — not the full inventory.

---

## Migrating configuration by feature

The following sections map each major area of [Frontend Plugin Wiring](frontend-plugin-wiring.md) to new-frontend-system `app-config` only.

### Dynamic routes and sidebar navigation

**Legacy:**

```yaml
dynamicPlugins:
  frontend:
    backstage.plugin-my-plugin:
      dynamicRoutes:
        - path: /my-plugin
          importName: MyPluginPage
          menuItem:
            icon: my-icon
            text: My Plugin
            priority: 100
```

**New:** Routes come from `page:*` extensions declared by the plugin. Customize title, path, or visibility via `app.extensions`:

```yaml
app:
  extensions:
    - page:my-plugin:
        config:
          title: My Plugin
          path: /my-plugin
    - page:my-plugin: false  # disable the page entirely
```

Sidebar navigation is derived from each page's `title` and `icon`. To enforce nav order, list page extensions in the desired order in `app.extensions`.

Nested sidebar menu groups (`menuItems.parent`) from RHDH dynamic plugins do not have a direct upstream equivalent — see [RHDH-specific gaps](#rhdh-specific-gaps) below.

### Entity page cards (mount points)

**Legacy:** Cards target `entity.page.*/cards` mount points with `importName` and optional `config.if` / `config.layout`.

```yaml
mountPoints:
  - mountPoint: entity.page.overview/cards
    importName: MyOverviewCard
    config:
      if:
        allOf:
          - isKind: component
      layout:
        gridColumn: "1 / span 6"
```

**New:** Cards are `entity-card:*` extensions. Most attach to `entity-content:catalog/overview` automatically. Override filters, card type, or disable:

```yaml
app:
  extensions:
    - entity-card:catalog/about:
        config:
          type: info
    - entity-card:my-plugin/overview-card:
        config:
          filter:
            kind: component
    - entity-card:catalog/labels: false  # hide default labels card
```

| Legacy mount point | Typical NFS extension |
| --- | --- |
| `entity.page.overview/cards` | `entity-card:*` → overview `cards` input |
| `entity.page.*/cards` (other tabs) | Plugin's `entity-content:*` or cards within that content |
| `entity.context.menu` | `entity-context-menu-item:*` |
| `search.page.results` | `search-result-list-item:*` |
| `search.page.filters` | `search-filter:*` |
| `search.page.types` | `search-filter-result-type:*` |

`config.layout` grid positioning from RHDH mount points is **not** available in `app.extensions`. Layout is determined by the overview layout (`info` vs `content` card types) or by the plugin component.

### Entity page tabs (`entityTabs`)

**Legacy:**

```yaml
entityTabs:
  - path: /my-tab
    title: My Tab
    mountPoint: entity.page.my-tab
    priority: 10
  - path: /
    title: General
    mountPoint: entity.page.overview
    priority: -6  # hide default overview tab
```

**New:** Tabs come from `entity-content:*` extensions attached to `page:catalog/entity`. Control groups and titles at two levels:

**1. Tab groups** on the entity page:

```yaml
app:
  extensions:
    - page:catalog/entity:
        config:
          showNavItemIcons: true
          groups:
            - overview:
                title: Overview
            - documentation:
                title: Documentation
            - development:
                title: Development
            - deployment:
                title: Deployment
```

Default groups: `overview`, `documentation`, `development`, `deployment`, `operation`, `observability`. Set `groups: []` to disable all default groups.

**2. Individual tab content:**

```yaml
app:
  extensions:
    - entity-content:techdocs:
        config:
          title: Docs
          icon: techdocs
          group: documentation
    - entity-content:api-docs/apis:
        config:
          title: APIs
          group: development
    - entity-content:kubernetes/kubernetes:
        config:
          group: deployment
    - entity-content:techdocs: false  # hide TechDocs tab
```

To show a content extension as a **standalone tab** (not grouped), set `group: false` in config.

Adding a **brand-new** tab requires a plugin that exports an `entity-content:*` extension — you cannot create one from YAML alone.

#### Default RHDH entity tab routes (legacy reference)

| Route | Title | Legacy mount point |
| --- | --- | --- |
| `/` | Overview | `entity.page.overview` |
| `/topology` | Topology | `entity.page.topology` |
| `/issues` | Issues | `entity.page.issues` |
| `/pr` | Pull/Merge Requests | `entity.page.pull-requests` |
| `/ci` | CI | `entity.page.ci` |
| `/cd` | CD | `entity.page.cd` |
| `/kubernetes` | Kubernetes | `entity.page.kubernetes` |
| `/api` | Api | `entity.page.api` |
| `/dependencies` | Dependencies | `entity.page.dependencies` |
| `/docs` | Docs | `entity.page.docs` |
| `/definition` | Definition | `entity.page.definition` |
| `/system` | Diagram | `entity.page.diagram` |

On the new frontend system, plugin tabs appear when the plugin exports a matching `entity-content:*` extension and it is not disabled in config. There is no `entityTabs` registry in app config.

### Search page

**Legacy:**

```yaml
mountPoints:
  - mountPoint: search.page.results
    importName: MySearchResultItem
  - mountPoint: search.page.filters
    importName: MySearchFilter
```

**New:**

```yaml
app:
  extensions:
    - search-result-list-item:my-plugin/custom-result
    - search-filter:my-plugin/custom-filter
    - search-filter-result-type:my-plugin/custom-type: false
```

### Application icons

**Legacy:** `appIcons` in `dynamicPlugins.frontend` registered components in the app icon catalog.

**New:** Page icons come from each `page:*` extension's `icon` (or `config.icon` as a string icon ID when icon bundles are installed). See [Icons](https://backstage.io/docs/conf/user-interface/icons/).

For most operators, icon customization is limited to `config.icon` string IDs on page and entity-content extensions.

### API factories

**Legacy:**

```yaml
apiFactories:
  - importName: myApiFactory
```

**New:** APIs are `api:*` extensions auto-discovered with the plugin. Adopters rarely configure them directly. To override behavior when supported:

```yaml
app:
  extensions:
    - api:my-plugin.config:
        config:
          goSlow: false
```

If a plugin still relies on legacy `apiFactories` YAML only, it needs a plugin update — see [Migrating Plugins to the New Frontend System](migrating-plugins-to-new-frontend-system.md).

### Translation resources

**Legacy:**

```yaml
translationResources:
  - importName: myPluginTranslations
```

**New:** Translations are `translation:*` extensions, usually auto-discovered. Override messages via extension config where the plugin supports it. See the plugin's documentation for supported override keys.

### Themes

RHDH theme customization continues to interact with Backstage theming. Dynamic plugins can supply `theme:*` extensions. Operator overrides:

```yaml
app:
  extensions:
    - theme:my-plugin/light:
        config:
          title: Corporate Light
```

See also [RHDH customization documentation](../customization.md).

### Scaffolder field extensions

**Legacy:** `scaffolderFieldExtensions` with `importName` entries.

**New:** Custom scaffolder fields are registered by the plugin automatically on the new frontend system. No YAML registration is required. Template grouping on the scaffolder sub-page:

```yaml
app:
  extensions:
    - sub-page:scaffolder/templates:
        config:
          groups:
            - title: Recommended Services
              filter:
                spec.type: service
```

---

## Catalog entity page changes

When RHDH moves to the upstream new frontend system entity page, several RHDH-specific tabs and layouts change. These are **not renames** — they reflect the upstream composition model introduced with the new frontend system (Backstage 1.49+ made NFS the default app template; entity cards and content are extension-driven).

### Dependencies tab → overview cards

**Legacy RHDH:** A dedicated `/dependencies` tab (`entity.page.dependencies`) with dependency cards and often a large relation graph.

**New frontend system:** There is no `/dependencies` entity-content tab in upstream. The same cards are available as overview extensions:

| Card | Extension ID |
| --- | --- |
| Depends on components | `entity-card:catalog/depends-on-components` |
| Depends on resources | `entity-card:catalog/depends-on-resources` |
| Has subcomponents | `entity-card:catalog/has-subcomponents` |
| Provided APIs | `entity-card:api-docs/provided-apis` |
| Consumed APIs | `entity-card:api-docs/consumed-apis` |
| Relation graph (smaller) | `entity-card:catalog-graph/relations` |

Enable and tune the graph card:

```yaml
app:
  extensions:
    - entity-card:catalog-graph/relations:
        config:
          height: 400
          direction: TOP_BOTTOM
```

To restore a dedicated Dependencies tab, a plugin must contribute a custom `entity-content:*` extension — this is not provided out of the box upstream.

### System diagram tab → catalog graph

**Legacy RHDH:** `/system` tab (`entity.page.diagram`) with a full-width `EntityCatalogGraphCard` and extended relation set.

**New frontend system:**

- Overview includes `entity-card:catalog-graph/relations` for a compact graph.
- The **View Graph** action on that card opens the standalone `page:catalog-graph` page.

There is no default system-only diagram tab. Configure the relations card for richer graphs:

```yaml
app:
  extensions:
    - entity-card:catalog-graph/relations:
        config:
          title: System Diagram
          height: 700
          direction: TOP_BOTTOM
          unidirectional: false
          relations:
            - partOf
            - hasPart
            - apiConsumedBy
            - apiProvidedBy
            - consumesApi
            - providesApi
            - dependencyOf
            - dependsOn
```

### API tab path change

**Legacy RHDH:** `/api` tab with provided/consumed API cards for service components.

**New frontend system:** `entity-content:api-docs/apis` at path `/apis` (note the **s**). Update bookmarks and documentation links accordingly.

### Overview layout

**Legacy RHDH:** Per-entity-kind MUI grid layout in app shell code (`OverviewTabContent.tsx`).

**New frontend system:** `DefaultEntityContentLayout` with `type: info` cards in a sticky sidebar and `type: content` cards in the main area. Warnings (orphan, relation, processing errors) are built into the layout — no separate mount point configuration.

```yaml
app:
  extensions:
    - entity-card:catalog/about:
        config:
          type: info
    - entity-card:catalog/links:
        config:
          type: info
```

### Built-in entity extensions reference

**Overview content:**

- `entity-content:catalog/overview`

**Common overview cards** (enable or configure as needed):

- `entity-card:catalog/about`
- `entity-card:catalog/labels`
- `entity-card:catalog/links`
- `entity-card:catalog-graph/relations`
- `entity-card:catalog/depends-on-components`
- `entity-card:catalog/depends-on-resources`
- `entity-card:catalog/has-subcomponents`
- `entity-card:catalog/has-components`
- `entity-card:catalog/has-resources`
- `entity-card:catalog/has-systems`
- `entity-card:api-docs/has-apis`
- `entity-card:api-docs/consumed-apis`
- `entity-card:api-docs/provided-apis`
- `entity-card:api-docs/providing-components`
- `entity-card:api-docs/consuming-components`
- `entity-card:org/group-profile`
- `entity-card:org/members-list`
- `entity-card:org/ownership`
- `entity-card:org/user-profile`

**Entity content tabs** (attach to `page:catalog/entity`):

- `entity-content:catalog/overview`
- `entity-content:api-docs/definition`
- `entity-content:api-docs/apis`
- `entity-content:techdocs`
- `entity-content:kubernetes/kubernetes`

Additional tabs (CI, CD, Argo CD, etc.) appear when the corresponding dynamic plugin exports an `entity-content:*` extension.

### Example: typical `app.extensions` starter for entity pages

Based on the [Backstage example `app-config.yaml`](https://github.com/backstage/backstage/blob/master/app-config.yaml):

```yaml
app:
  extensions:
    # Entity page cards
    - entity-card:catalog/about:
        config:
          type: info
    - entity-card:catalog/links:
        config:
          type: info
    - entity-card:catalog-graph/relations:
        config:
          height: 300
    - entity-card:api-docs/consumed-apis
    - entity-card:api-docs/provided-apis
    - entity-card:org/group-profile
    - entity-card:org/members-list
    - entity-card:org/ownership
    - entity-card:org/user-profile

    # Entity page contents (tabs)
    - entity-content:catalog/overview
    - entity-content:api-docs/definition
    - entity-content:api-docs/apis
    - entity-content:techdocs
    - entity-content:kubernetes/kubernetes
```

---

## User settings page

RHDH today hardcodes settings UI extensions in the app package. The upstream `user-settings` plugin exports `page:user-settings` and sub-pages (`general`, `auth-providers`, `feature-flags`).

| Customization goal | New frontend system support today |
| --- | --- |
| Replace the entire settings page | Override `page:user-settings` via `app.extensions` (interim escape hatch) |
| Add cards to General settings | **Not yet** — `sub-page:user-settings/general` has no card/content input in upstream |
| Hide a default settings card | **Not yet** — default cards are not individual extensions |

Extensible user settings is tracked as product work. Until upstream adds extension inputs on the General sub-page, partners may need to replace the full settings page or wait for plugin updates.

---

## Operator cheat sheet

| Task | Legacy RHDH | New frontend system |
| --- | --- | --- |
| Install a plugin | `dynamic-plugins.yaml` entry | Same — `dynamic-plugins.yaml` `enabled: true` |
| Disable a plugin page | Remove route or `menuItem.enabled: false` | `app.extensions: ['page:my-plugin': false]` |
| Rename sidebar item | `menuItem.text` | `page:my-plugin` → `config.title` |
| Reorder sidebar | `menuItems.*.priority` | Order in `app.extensions` |
| Hide entity overview card | Remove mount point entry | `entity-card:*: false` |
| Change card visibility filter | `mountPoints[].config.if` | `entity-card:*` → `config.filter` |
| Rename entity tab | `entityTabs[].title` | `entity-content:*` → `config.title` |
| Reorder / group entity tabs | `entityTabs` + `priority` | `page:catalog/entity` → `config.groups` |
| Hide entity tab | Negative `entityTabs` priority | `entity-content:*: false` |
| Bind catalog → TechDocs | `routeBindings` | `app.routes.bindings` |
| Disable route binding | Omit binding | `app.routes.bindings.<name>: false` |

---

## What you cannot do from configuration alone

- **Attach arbitrary exported components** to mount points without a matching NFS extension from the plugin.
- **Replicate `mountPoints[].config.layout`** grid column positioning — use card `type: info|content` or ask the plugin vendor to adjust the component layout.
- **Add a new entity tab** without a plugin that exports `entity-content:*`.
- **Add cards to General settings** until upstream exposes extension inputs on `sub-page:user-settings/general`.
- **Use RHDH-only mount points** (some global header slots) until equivalent NFS extensions exist. Application drawers have `AppDrawerContentBlueprint` — see the [plugins guide](migrating-plugins-to-new-frontend-system.md#adding-application-drawers-applicationinternaldrawer).

## RHDH-specific gaps

| Feature | Status on new frontend system |
| --- | --- |
| Nested sidebar menu groups (`menuItems.parent`) | No direct equivalent — flat nav from pages |
| Application drawer mount points | `AppDrawerContentBlueprint` available — requires plugin update (see [plugins guide](migrating-plugins-to-new-frontend-system.md#adding-application-drawers-applicationinternaldrawer)) |
| `global.header/help` and similar header slots | Migrating in RHDH global-header plugins |
| `mountPoints[].config.layout` (MUI grid) | Not configurable via YAML |
| Legacy `staticJSXContent` pattern | Requires a plugin update |

Plugin-side changes are covered in [Migrating Plugins to the New Frontend System](migrating-plugins-to-new-frontend-system.md).

---

## Troubleshooting

### An extension does not appear

1. Confirm the plugin is **enabled** in `dynamic-plugins.yaml`.
2. Confirm the plugin supports the **new frontend system** — plugins that only support legacy frontend wiring do not register extensions.
3. Check whether the extension is **disabled** in `app.extensions`.
4. Check **filter** config — entity cards and content hide themselves when the filter does not match the current entity.
5. Use the Backstage **app visualizer** plugin during migration to inspect the extension tree ([migrating apps guide](https://backstage.io/docs/frontend-system/building-apps/migrating/#using-the-app-visualizer-plugin)).

### My `app.extensions` override has no effect

- A higher-priority config file may **replace** the entire `app.extensions` array — verify merge order.
- Extension `config` is replaced wholesale; ensure you include all keys you need in the override file.
- Verify the extension ID spelling matches the plugin's registered ID (`entity-card:namespace/name`).

### Entity tab order looks wrong

- Configure `page:catalog/entity` → `config.groups` explicitly.
- List `entity-content:*` extensions in `app.extensions` in the desired order within their groups.

### Catalog page missing Dependencies or Diagram tab

- Expected on the new frontend system — see [Catalog entity page changes](#catalog-entity-page-changes). Cards moved to Overview; system diagram uses the catalog-graph card and page.

---

## Further reading

### RHDH documentation

- [Frontend Plugin Wiring](frontend-plugin-wiring.md) — legacy configuration reference
- [Migrating Plugins to the New Frontend System](migrating-plugins-to-new-frontend-system.md) — plugin author guide
- [Installing Plugins](installing-plugins.md)
- [Version Compatibility Matrix](versions.md)

### Backstage new frontend system

- [Frontend System Introduction](https://backstage.io/docs/frontend-system/)
- [Configuring Extensions](https://backstage.io/docs/frontend-system/building-apps/configuring-extensions/)
- [Built-in Extensions](https://backstage.io/docs/frontend-system/building-apps/built-in-extensions/)
- [Frontend Routes](https://backstage.io/docs/frontend-system/architecture/routes/)
- [Example `app-config.yaml`](https://github.com/backstage/backstage/blob/master/app-config.yaml)
