# Migrating RHDH Frontend Plugins to the Backstage New Frontend System

This guide helps **plugin authors** who built frontend plugins for Red Hat Developer Hub (RHDH) using the **legacy Backstage frontend system** and **RHDH dynamic plugin wiring** (`dynamicPlugins.frontend` in `app-config.yaml`). It explains how to migrate plugin **code** to the **Backstage new frontend system** — the extension-based architecture documented in the [Frontend System](https://backstage.io/docs/frontend-system/).

> **Plugin authors** → this document.
>
> **Operators and platform admins** customizing RHDH through YAML only (no plugin source changes) → [Migrating Config to the New Frontend System](migrating-config-to-new-frontend-system.md).

> **Scope:** This guide covers every configuration case documented in [Frontend Plugin Wiring](frontend-plugin-wiring.md) from a **plugin implementation** perspective. RHDH itself is transitioning to the new frontend system; some RHDH-specific mount points may remain available only in the current dynamic-plugin host until equivalent extensions exist upstream or in RHDH.

## Who should read this

- Plugin authors who exported dynamic frontend plugins with `@red-hat-developer-hub/cli plugin export` and wired them via `pluginConfig.dynamicPlugins.frontend`.
- Teams that used `createPlugin`, `createRoutableExtension`, `createComponentExtension`, and similar legacy APIs.
- Overlay maintainers adding or updating `/alpha` exports for dynamic plugin OCI images.

If you only need to translate existing `dynamic-plugins.yaml` / `app-config` customization into the new frontend system — without changing plugin packages — use [Migrating Config to the New Frontend System](migrating-config-to-new-frontend-system.md) instead.

## What changes

| Aspect | RHDH dynamic plugin wiring | New frontend system |
| --- | --- | --- |
| Plugin definition | `createPlugin` + extension helpers in `src/index.ts` | `createFrontendPlugin` in `src/alpha.tsx` |
| Package export | `scalprum.exposedModules` in `package.json` (default `PluginRoot` → `src/index.ts`) | `./alpha` entry point with `createFrontendPlugin` default export |
| Dynamic plugin identity in YAML | `scalprum.name` keys the `dynamicPlugins.frontend` block | Installed package; operators use the package as published |
| Pages / routes | `dynamicRoutes` + optional `menuItem` in config | `PageBlueprint` in plugin code; nav from page `title`/`icon` |
| Entity UI | `mountPoints` + `entityTabs` string IDs | `EntityCardBlueprint`, `EntityContentBlueprint`, etc. |
| Cross-plugin links | `routeBindings` in plugin config | `externalRoutes` in plugin + `app.routes.bindings` |
| APIs | `apiFactories` or `createPlugin({ apis })` | `ApiBlueprint` extensions (auto-discovered) |
| Adopter customization | Per-plugin `dynamicPlugins.frontend.<name>` block | `app.extensions`, `app.routes.bindings`, `app.packages` |
| Wiring location | Mostly **configuration** (YAML) | Mostly **plugin code** (extensions), with **optional** `app.extensions` overrides |

The biggest mindset shift: in RHDH dynamic wiring, adopters declare *what component goes where* in YAML. In the new frontend system, plugins declare *where they attach* in code (via extension blueprints), and adopters override *behavior* (titles, filters, ordering, disable) through `app.extensions`.

## Before you begin

1. **Keep legacy exports during migration.** Unless your plugin is private to a single app, add the new frontend system under `src/alpha.tsx` and export it from `./alpha` in `package.json`. Keep the existing default export for backward compatibility until RHDH and your consumers no longer need it.

2. **Read the upstream migration guides:**
   - [Migrating Plugins](https://backstage.io/docs/frontend-system/building-plugins/migrating/)
   - [Migrating Apps](https://backstage.io/docs/frontend-system/building-apps/migrating/)
   - [Configuring Extensions](https://backstage.io/docs/frontend-system/building-apps/configuring-extensions/)

3. **Study a migrated plugin.** Good references in the Backstage repo: `@backstage/plugin-catalog/alpha`, `@backstage/plugin-techdocs/alpha`, `@backstage/plugin-scaffolder/alpha`.

4. **Check the [version matrix](versions.md)** when re-exporting dynamic plugin packages with the RHDH CLI.

## API breaking changes

If you previously migrated against an early alpha of the new frontend system, update your code for these changes:

### Blueprint param renames (v1.42.0+)

| Blueprint | Old param | New param |
| --- | --- | --- |
| `PageBlueprint` | `defaultPath` | `path` |
| `EntityContentBlueprint` | `defaultPath` | `path` |
| `EntityContentBlueprint` | `defaultTitle` | `title` |
| `EntityContentBlueprint` | `defaultGroup` | `group` |
| `AppRootWrapperBlueprint` | `Component` (uppercase) | `component` (lowercase) |

### `makeWithOverrides` config schema (v1.42.0+)

The `config: { schema: {...} }` callback is deprecated. Use `configSchema` with a direct `zod/v4` import:

```tsx
// Old
EntityContentBlueprint.makeWithOverrides({
  config: { schema: { filter: z => z.string().optional() } },
  ...
});

// New
import { z } from 'zod/v4';
EntityContentBlueprint.makeWithOverrides({
  configSchema: { filter: z.string().optional() },
  ...
});
```

---

## Migration strategy

We recommend a three-phase approach:

### Phase 1 — Add `/alpha` without changing RHDH wiring

1. Create `src/alpha.tsx` with `createFrontendPlugin` and extension blueprints.
2. Export `./alpha` from `package.json`.
3. Keep the alpha entry lightweight: blueprints and loaders with real `import()` — do not statically import page UI into the entry (see [Keep the NFS entry lightweight](#keep-the-nfs-entry-lightweight-lazy-loading)).
4. Verify the plugin builds (`yarn tsc`) and unit tests pass.

The legacy `PluginRoot` export can remain the entry point for the current RHDH dynamic plugin host.

### Phase 2 — Move wiring from YAML into plugin extensions

For each item in your `dynamicPlugins.frontend.<package>` config, implement the equivalent extension in `src/alpha.tsx` so the plugin is self-describing. Remove redundant YAML once the new path is validated.

### Phase 3 — Validate in a new-frontend-system app

1. Add the plugin as an app dependency (or install manually via `createApp({ features: [...] })`).
2. Set `app.packages: all` (or include your package explicitly).
3. Use `app.extensions` only for adopter-specific overrides (titles, filters, ordering).
4. Run the app and verify routes, entity tabs, APIs, and cross-plugin links.

#### Dev app setup

Add a new frontend system dev app alongside the existing legacy dev app:

```tsx
// dev/nfs.tsx
import ReactDOM from 'react-dom/client';
import { createApp } from '@backstage/frontend-defaults';
import myPlugin from '../src/alpha';

const app = createApp({ features: [myPlugin] });
ReactDOM.createRoot(document.getElementById('root')!).render(app.createRoot());
```

```json
"start:nfs": "backstage-cli package start --entrypoint dev/nfs"
```

---

## Plugin code migration primer

### Legacy plugin

```typescript
// src/plugin.ts
import { createPlugin, createRoutableExtension } from '@backstage/core-plugin-api';

export const myPlugin = createPlugin({
  id: 'my-plugin',
  apis: [myApiFactory],
  routes: { root: rootRouteRef },
  externalRoutes: { entityPage: entityPageExternalRouteRef },
});

export const MyPage = myPlugin.provide(
  createRoutableExtension({
    name: 'MyPage',
    component: () => import('./components/MyPage').then(m => m.MyPage),
    mountPoint: rootRouteRef,
  }),
);
```

### New frontend system plugin

```tsx
// src/alpha.tsx
import {
  createFrontendPlugin,
  PageBlueprint,
  ApiBlueprint,
} from '@backstage/frontend-plugin-api';
import { rootRouteRef, entityPageExternalRouteRef } from './routes';

const myApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: myApiRef,
      deps: { /* ... */ },
      factory: ({ /* ... */ }) => new MyApiImpl(),
    }),
});

const myPage = PageBlueprint.make({
  params: {
    path: '/my-plugin',
    routeRef: rootRouteRef,
    title: 'My Plugin',
    icon: <MyIcon />,
    loader: () => import('./components/MyPage').then(m => <m.MyPage />),
  },
});

export default createFrontendPlugin({
  pluginId: 'my-plugin',
  extensions: [myApi, myPage],
  routes: { root: rootRouteRef },
  externalRoutes: { entityPage: entityPageExternalRouteRef },
});
```

```json
// package.json exports
{
  "exports": {
    ".": "./src/index.ts",
    "./alpha": "./src/alpha.tsx",
    "./package.json": "./package.json"
  }
}
```

---

## Keep the NFS entry lightweight (lazy loading)

In RHDH dynamic plugin mode, each frontend plugin is a Module Federation remote. The bundler starts from the expose entry (package root or `./alpha`) and places every module reachable through a **static** `import` into **sync chunks**. Those chunks download and parse before the plugin can register its extensions.

| Term | Meaning |
| --- | --- |
| Sync chunk | JavaScript loaded eagerly when the remote entry is evaluated (startup path) |
| Async chunk | JavaScript loaded only when `import()` runs at runtime |
| Expose entry | The Module Federation entry (often the package default export or `./alpha`) |

**Key rule:** `loader: async () => <MyComponent />` does **not** lazy-load `MyComponent` if it was statically imported in the same file. The bundler resolves static imports at build time and includes them in the sync graph.

Keep the NFS entry limited to blueprints, routes, API factories, extension definitions, and types. Load heavy React trees, form libraries, charts, and large component graphs with `import()` inside blueprint loaders (or other explicit lazy boundaries).

### Patterns that matter during migration

#### 1. Use real `import()` in loaders — never a static import of the same component

```tsx
// Wrong — SignInPage lands in the sync chunk despite the async loader
import { SignInPage } from './components/SignInPage';

SignInPageBlueprint.make({
  params: {
    loader: async () => props => <SignInPage {...props} />,
  },
});

// Correct — only the dynamic import references the component
SignInPageBlueprint.make({
  params: {
    loader: () =>
      import('./components/SignInPage').then(m => m.SignInPage),
  },
});
```

Also avoid re-exporting heavy UI from the NFS entry (`export { SignInPage } from './components/SignInPage'`).

#### 2. `Promise.resolve` is not lazy-loading

Returning `Promise.resolve({ Content: AlreadyImportedComponent })` looks async but does not create an async chunk. The `components` callback (for example on `HomePageWidgetBlueprint`) must call `import()`:

```tsx
components: async () => {
  const { ScorecardHomepageCardWithProvider } = await import(
    '../../components/ScorecardHomepageSection'
  );
  return {
    Content: () => (
      <ScorecardHomepageCardWithProvider metricId="jira.openIssues" />
    ),
  };
},
```

#### 3. Move page and layout imports into blueprint loaders

Extension registration files should not statically import routers, layouts, or tab content:

```tsx
PageBlueprint.make({
  params: {
    path: '/my-plugin',
    loader: () => import('./components/Router').then(m => <m.Router />),
  },
});
```

The same applies to layout overrides — `await import(...)` inside the loader, then return the layout component.

#### 4. Defer heavy work behind API factories

`ApiBlueprint` registration is synchronous. If an API implementation needs a large UI module (for example RJSF widgets), keep a thin API shell and load the heavy module with `import()`, caching the promise:

```tsx
this.contentPromise ??= import('./FormDecoratorContent');
```

#### 5. Prefer blueprint `loader` over sync `component`

When a blueprint accepts both `component` and `loader`, prefer `loader` so UI stays out of the sync graph. Data-driven params (icon name + title + link) are even better when the blueprint supports them — no custom React import required.

#### 6. Split heavy building blocks onto a secondary export

If your plugin exposes reusable UI for other plugins, keep the package root to plugin, module, blueprints, types, and defaults. Publish React building blocks on a secondary entry (for example `./components`) and document that consumers must dynamic-import it:

```tsx
loader: async () => {
  const { GlobalHeaderDropdown } = await import(
    '@my-org/plugin-global-header/components'
  );
  return () => <GlobalHeaderDropdown target="help" />;
},
```

Treat another plugin's `/components` subpath as a heavy optional dependency. Prefer thin `/blueprints` imports plus a local stub when visual parity does not require the full building-block tree.

#### 7. Keep icons and helpers free of page UI

Icons and nav metadata referenced from sync extension definitions must not import from files that also pull in permission hooks, sidebar utilities, or page components. Split icons and URL helpers into small modules with minimal dependencies.

#### 8. Conditional `import()` for mutually exclusive paths

```tsx
loader: async () => {
  if (layouts.length > 0) {
    const { LayoutSwitcher } = await import('../components/LayoutSwitcher');
    return <LayoutSwitcher layouts={layouts} />;
  }
  const { EntityContent } = await import('../components/EntityContent');
  return <EntityContent />;
},
```

#### 9. Thin lazy shells when a blueprint requires a sync `element`

Some blueprints (`AppDrawerContentBlueprint`, certain root elements) take a sync `element` or `component`. Wrap heavy UI in a tiny module that only exports a `React.lazy` + `Suspense` shell, and import that shell from the entry — not the real drawer/chat tree:

```tsx
// lazyDrawerUi.tsx — only this is imported from alpha/index
const LazyDrawerContent = lazy(() =>
  import('./DrawerContent').then(m => ({ default: m.DrawerContent })),
);

export const DrawerContentElement = (
  <Suspense fallback={null}>
    <LazyDrawerContent />
  </Suspense>
);

// alpha.tsx
params: { id: MY_DRAWER_ID, element: DrawerContentElement }
```

Prefer a blueprint `loader` when the API supports it.

### Blueprint lazy-loading support

| Blueprint / API | Lazy loading? | Guidance |
| --- | --- | --- |
| `PageBlueprint` `loader` | Yes | Preferred for route content |
| `PageBlueprint` `icon` | Limited | Icon JSX is evaluated at registration — keep icons minimal |
| `EntityContentBlueprint` `loader` | Yes | Preferred for entity tab content |
| `SignInPageBlueprint` `loader` | Yes | Component must come from `import()` |
| `HomePageLayoutBlueprint` loader | Yes | Dynamic-import the layout inside the loader |
| `HomePageWidgetBlueprint` `components` | Yes | Must use `import()`, not `Promise.resolve` |
| `NavItemBlueprint` | Limited | Prefer page `title`/`icon`; icon must be a sync `IconComponent` |
| `AppRootWrapperBlueprint` | Limited | Wrappers run at startup — keep them thin |
| `AppDrawerContentBlueprint` / `AppRootElementBlueprint` | Partial | Sync `element` — use thin lazy + `Suspense` shells |
| `ApiBlueprint` | Partial | Factory is sync; defer heavy modules inside API methods |
| Custom header blueprints (`loader`) | Yes | Prefer `loader` / data-driven params over sync `component` |

### What you cannot fully optimize at plugin level

| Limitation | Guidance |
| --- | --- |
| Nav / page icons | Use minimal SVGs or small icon components; full deferral may need upstream API changes |
| App shell wrappers | Must be available at startup; only child contributions should be lazy |
| Zod in blueprint `configSchema` | Can appear in sync chunks; shared MF dependency config is a platform concern |
| Duplicate React / MUI across remotes | Fixed by Module Federation `shared` config, not by lazy loading alone |
| Peer `/components` graphs | Importing another plugin's building blocks pulls that UI into **your** async chunk |

### Validate sync vs async chunks

Goal: minimize JavaScript on the **startup** path (sync size), not merely total bundle size. Successful refactors often lower sync size and raise async size.

1. From the plugin package, build the Module Federation bundle before and after changes:

   ```bash
   cd plugins/<your-plugin>
   yarn backstage-cli package bundle
   ```

2. Compare the NFS expose you care about (package root or `./alpha`) using `mf-manifest.json` and chunk files under `dist-dynamic/` (or the CLI's equivalent output). Confirm heavy libraries moved out of sync chunks.

3. Report results in a short table:

   | Metric | BEFORE | AFTER | Δ |
   | --- | --- | --- | --- |
   | Sync chunks | … | … | … |
   | Sync size | … KB | … KB | … KB (…%) |
   | Async chunks | … | … | … |
   | Async size | … KB | … KB | … KB |

4. Smoke-test: open plugin routes, lazy menus/dropdowns, icons, translations, and sign-in. Watch for blank UI or missing nav items.

### Do / don't

**Do**

- Keep NFS extension files limited to blueprints, routes, API factories, and types
- Use `import()` inside loaders for any component not needed at registration
- Cache repeated dynamic imports (`??=`) when the same module is requested often
- Split optional UI onto secondary package/MF exports; import registration APIs from thin subpaths when available
- Use thin `React.lazy` + `Suspense` shells when a blueprint requires a sync `element`
- Inspect `mf-manifest.json` after migration and compare sync metrics

**Don't**

- Assume an `async` loader lazy-loads a statically imported component
- Use `Promise.resolve(...)` as a substitute for `import()`
- Statically import page routers, layouts, or heavy widgets in entry/extension definition modules
- Call `import()` at module scope in files that are statically imported from registration code
- Re-export heavy UI from the NFS root when consumers only need registration APIs
- Import peer-plugin `/components` building blocks when a local stub or `/blueprints` + `loader` is enough

---

## Configuration migration reference

Each subsection maps one topic from [Frontend Plugin Wiring](frontend-plugin-wiring.md) to the new frontend system. Sections follow the same order as that document.

### Extend internal library of available icons (`appIcons`)

**RHDH wiring:**

```yaml
dynamicPlugins:
  frontend:
    my.package:
      appIcons:
        - name: fooIcon
          importName: FooIcon
```

**New approach — plugin code:**

Register icons with `IconBundleBlueprint` from `@backstage/plugin-app-react`:

```tsx
import { IconBundleBlueprint } from '@backstage/plugin-app-react';

const myIcons = IconBundleBlueprint.make({
  params: {
    icons: {
      fooIcon: <FooIcon />,
    },
  },
});

// Add myIcons to createFrontendPlugin({ extensions: [...] })
```

**Adopter configuration:** Usually none. Icons are discovered with the plugin. Pages and entity tabs can reference icon IDs as strings in `app.extensions` config when icon bundles are installed.

**Notes:**

- RHDH `appIcons` registered icons globally for `menuItem.icon` string references. In the new system, prefer `PageBlueprint` `icon` params (component) or registered icon bundle IDs.
- See [Icons](https://backstage.io/docs/conf/user-interface/icons/) and [IconBundleBlueprint](https://backstage.io/docs/frontend-system/building-plugins/common-extension-blueprints/).

---

### Dynamic routes (`dynamicRoutes`)

**RHDH wiring:**

```yaml
dynamicPlugins:
  frontend:
    my.package:
      dynamicRoutes:
        - path: /my-plugin
          importName: MyPage
          menuItem:
            icon: docs
            text: My Plugin
```

**New approach — plugin code:**

```tsx
const myPage = PageBlueprint.make({
  params: {
    path: '/my-plugin',
    routeRef: rootRouteRef,
    title: 'My Plugin',
    icon: <DocsIcon />,
    loader: () => import('./components/MyPage').then(m => <m.MyPage />),
  },
});
```

**Adopter configuration:**

```yaml
app:
  extensions:
    - page:my-plugin:
        config:
          title: Custom Title
          path: /custom-path   # when blueprint supports path override
```

**Notes:**

- You no longer declare `importName` in YAML — the `loader` in the blueprint points at your component.
- Sidebar entries are inferred from page extensions. `NavItemBlueprint` was removed; do not create separate nav-item extensions.
- Custom `SidebarItem` components from RHDH `menuItem.importName` have no direct equivalent — use `NavContentBlueprint` to replace the entire sidebar, or keep the default nav item styling.
- Sub-routes within a page use `SubPageBlueprint` (see scaffolder templates as an example).

---

### Menu items (`menuItems`)

**RHDH wiring:**

```yaml
dynamicPlugins:
  frontend:
    my.package:
      menuItems:
        my-plugin:
          priority: 10
          parent: favorites
        favorites:
          title: Favorites
          priority: 100
```

**New approach:**

| RHDH feature | New frontend system equivalent |
| --- | --- |
| `menuItem.text` / `title` | `PageBlueprint` `title` param or `app.extensions` `config.title` |
| `menuItem.icon` | `PageBlueprint` `icon` param or `config` icon ID |
| `priority` | Order entries in `app.extensions` (listed extensions render first, in list order) |
| Nested `parent` menus | No built-in equivalent yet — use `NavContentBlueprint` for custom sidebar layout |

**Adopter configuration:**

```yaml
app:
  extensions:
    - page:catalog
    - page:my-plugin
    - page:scaffolder
    # Order above controls sidebar order for listed pages
```

**Notes:**

- Nested sidebar groups (up to 3 levels) are an RHDH dynamic-plugin feature. Standard Backstage new-frontend-system apps use a flat nav derived from pages unless you customize `app/nav` via `NavContentBlueprint`.

---

### Bind to existing plugins (`routeBindings`)

**RHDH wiring:**

```yaml
dynamicPlugins:
  frontend:
    my.package:
      routeBindings:
        targets:
          - importName: barPlugin
        bindings:
          - bindTarget: barPlugin.externalRoutes
            bindMap:
              headerLink: fooPlugin.routes.root
```

**New approach — plugin code:**

Declare `externalRoutes` on the frontend plugin:

```tsx
export default createFrontendPlugin({
  pluginId: 'bar',
  externalRoutes: {
    headerLink: headerLinkExternalRouteRef,
  },
  routes: {
    root: rootRouteRef,
  },
  // ...
});
```

**Adopter configuration:**

```yaml
app:
  routes:
    bindings:
      bar.headerLink: foo.root
      scaffolder.registerComponent: false
```

Or programmatically in `createApp({ bindRoutes({ bind }) { ... } })`.

**Notes:**

- Binding syntax uses `pluginId.routeName` (for example `catalog.viewTechDoc: techdocs.docRoot`).
- External route refs can declare `defaultTarget` in plugin code to reduce required app config.
- See [Frontend Routes](https://backstage.io/docs/frontend-system/architecture/routes/).

---

### Using mount points — entity page cards (`entity.page.*/cards`)

**RHDH wiring:**

```yaml
mountPoints:
  - mountPoint: entity.page.overview/cards
    importName: MyOverviewCard
    config:
      layout:
        gridColumn: "1 / -1"
      if:
        allOf:
          - isKind: component
```

**New approach — plugin code:**

```tsx
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';

const myOverviewCard = EntityCardBlueprint.make({
  name: 'my-overview',
  params: {
    filter: { kind: 'component' },
    loader: async () => {
      const { MyOverviewCard } = await import('./components/MyOverviewCard');
      return <MyOverviewCard />;
    },
  },
});
```

Default attachment: `entity-content:catalog/overview` input `cards`.

**Adopter configuration:**

```yaml
app:
  extensions:
    - entity-card:my-plugin/my-overview:
        config:
          filter:
            kind: component
          type: info
```

**Notes:**

- `EntityCardBlueprint` replaces `createEntityCardExtension` / mount-point card wiring.
- Layout grid positioning from RHDH `config.layout` is not a standard blueprint config — implement layout inside your card component or use extension overrides for advanced cases.
- Filter predicates use the [filter predicate](https://backstage.io/api/stable/modules/_backstage_filter-predicates.html) schema in config (not the RHDH `isKind`/`isType` shorthand, though similar concepts apply).

---

### Using mount points — entity page tab content (`entity.page.*` without `/cards`)

**RHDH wiring:**

```yaml
mountPoints:
  - mountPoint: entity.page.docs/cards
    importName: EntityTechdocsContent
```

For full tabs, RHDH often combines `entityTabs` + mount points (see below).

**New approach — plugin code:**

```tsx
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';

const myEntityContent = EntityContentBlueprint.make({
  name: 'my-tab',
  params: {
    path: 'my-tab',
    title: 'My Tab',
    group: 'development',
    routeRef: myEntityRouteRef, // optional, for routable content
    loader: () => import('./MyTab').then(m => <m.MyTab />),
  },
});
```

Attaches to `page:catalog/entity` input `contents`.

**Adopter configuration:**

```yaml
app:
  extensions:
    - entity-content:my-plugin/my-tab:
        config:
          title: Renamed Tab
          group: deployment
          icon: kubernetes
```

---

### Using mount points — entity context menu (`entity.context.menu`)

**RHDH wiring:**

```yaml
mountPoints:
  - mountPoint: entity.context.menu
    importName: SimpleDialog
    config:
      props:
        title: Open Simple Dialog
        icon: dialogIcon
```

**New approach — plugin code:**

```tsx
import { EntityContextMenuItemBlueprint } from '@backstage/plugin-catalog-react/alpha';

const myMenuItem = EntityContextMenuItemBlueprint.make({
  name: 'my-action',
  params: {
    icon: <DialogIcon />,
    title: 'Open Simple Dialog',
    onClick: ({ entity, dialogApi }) => { /* ... */ },
    // or href: ...
    filter: entity => entity.kind === 'Component',
  },
});
```

**Adopter configuration:** Typically none — menu items are defined in the plugin.

**Notes:**

- The new system uses data-driven menu item extensions, not dialog wrapper components with `open`/`onClose` props. Refactor dialog lifecycle into your blueprint's `onClick` handler.

---

### Using mount points — search page (`search.page.*`)

**RHDH wiring:**

| Mount point | Purpose |
| --- | --- |
| `search.page.types` | Search result type tabs |
| `search.page.filters` | Filter controls |
| `search.page.results` | Result list item renderers |

**New approach — plugin code:**

| Mount point | Blueprint | Attaches to |
| --- | --- | --- |
| Result items | `SearchResultListItemBlueprint` | `page:search` input `items` |
| Filters | `SearchFilterBlueprint` | `page:search` input `filters` |
| Result types | `SearchFilterResultTypeBlueprint` | `page:search` input `types` |

Example:

```tsx
import { SearchResultListItemBlueprint } from '@backstage/plugin-search-react/alpha';

const mySearchItem = SearchResultListItemBlueprint.make({
  params: {
    predicate: result => result.type === 'my-type',
    component: async () => {
      const { MyResultItem } = await import('./MyResultItem');
      return props => <MyResultItem {...props} />;
    },
  },
});
```

**Adopter configuration:**

```yaml
app:
  extensions:
    - search-result-list-item:my-plugin:
        config:
          title: Custom Label
```

---

### Adding application header (`application/header`)

**RHDH wiring:**

```yaml
mountPoints:
  - mountPoint: application/header
    importName: GlobalHeader
    config:
      position: above-main-content
```

**New approach:**

Use `AppRootElementBlueprint` or `AppRootWrapperBlueprint` from `@backstage/plugin-app-react`, attached to `app/root`:

```tsx
import { AppRootElementBlueprint } from '@backstage/plugin-app-react';

const myHeader = AppRootElementBlueprint.make({
  name: 'my-header',
  params: {
    loader: async () => {
      const { GlobalHeader } = await import('./GlobalHeader');
      return <GlobalHeader />;
    },
  },
});
```

**Notes:**

- RHDH's global header plugin (`red-hat-developer-hub.backstage-plugin-global-header`) is being migrated to extension blueprints in `rhdh-plugins`. The `position: above-main-content` concept is app-layout-specific — verify layout behavior when migrating.
- Multiple headers may require coordination via extension ordering in `app.extensions`.

---

### Adding application listeners (`application/listener`)

**RHDH wiring:**

```yaml
mountPoints:
  - mountPoint: application/listener
    importName: MyListener
```

**New approach:**

Use `AppRootElementBlueprint` (renders outside the main layout, alongside alert display and OAuth dialog):

```tsx
const myListener = AppRootElementBlueprint.make({
  name: 'my-listener',
  params: {
    loader: async () => {
      const { MyListener } = await import('./MyListener');
      return <MyListener />;
    },
  },
});
```

---

### Adding application providers (`application/provider`)

**RHDH wiring:**

```yaml
mountPoints:
  - mountPoint: application/provider
    importName: MyProvider
```

**New approach:**

Use `AppRootWrapperBlueprint` or `PluginWrapperBlueprint`:

```tsx
import { AppRootWrapperBlueprint } from '@backstage/plugin-app-react';

const myProvider = AppRootWrapperBlueprint.make({
  params: {
    component: MyProvider, // wraps the app root
  },
});
```

For plugin-scoped providers (only wrap that plugin's UI):

```tsx
import { PluginWrapperBlueprint } from '@backstage/frontend-plugin-api/alpha';

const myPluginWrapper = PluginWrapperBlueprint.make({
  params: { component: MyPluginProvider },
});
```

---

### Adding application drawers (`application/internal/drawer-*`)

**RHDH wiring:** Uses `application/provider`, `application/internal/drawer-state`, and `application/internal/drawer-content` mount points with RHDH-coordinated drawer management.

**New approach — plugin code:**

RHDH provides `AppDrawerContentBlueprint` from `@red-hat-developer-hub/backstage-plugin-app-react/alpha`:

```tsx
import { AppDrawerContentBlueprint } from '@red-hat-developer-hub/backstage-plugin-app-react/alpha';
import { DrawerContentElement } from './lazyDrawerUi'; // thin React.lazy + Suspense shell

const myDrawer = AppDrawerContentBlueprint.make({
  name: 'my-drawer',
  params: {
    id: MY_DRAWER_ID,
    element: DrawerContentElement, // do not statically import the real drawer tree here
    resizable: true,
    defaultWidth: 400,
  },
});
```

Register in your plugin's `extensions` array. See [thin lazy shells](#9-thin-lazy-shells-when-a-blueprint-requires-a-sync-element) for the shell pattern.

> **Init logic:** Drawer content mounts/unmounts with the drawer. Persistent initialization (auto-open triggers, event listeners) must go in a separate `AppRootElementBlueprint` via `createFrontendModule({ pluginId: 'app' })`.

**Notes:**

- `AppDrawerContentBlueprint` is RHDH-specific — not available in upstream Backstage.
- Prefer a blueprint `loader` when available; for sync `element` params, export only a lazy + `Suspense` shell from the registration path.
- See [lightspeed #2721](https://github.com/redhat-developer/rhdh-plugins/pull/2721) and [quickstart #2842](https://github.com/redhat-developer/rhdh-plugins/pull/2842) for real migration examples.

---

### Customizing and adding entity tabs (`entityTabs`)

**RHDH wiring:**

```yaml
entityTabs:
  - path: /new-path
    title: My New Tab
    mountPoint: entity.page.my-new-tab
  - path: /
    title: General
    mountPoint: entity.page.overview
    priority: -6
```

**New approach — plugin code (new tab):**

Define an `EntityContentBlueprint` (see above). The tab appears when the extension is installed and its entity filter matches.

**New approach — adopter config (rename/reorder/hide groups):**

```yaml
app:
  extensions:
    - page:catalog/entity:
        config:
          showNavItemIcons: true
          groups:
            - overview:
                title: General
            - documentation:
                title: Docs
            - development: false   # hide a default group
            - custom:
                title: My New Tab
    - entity-content:my-plugin/my-tab:
        config:
          title: My New Tab
          group: custom
```

Default groups: `overview`, `documentation`, `development`, `deployment`, `operation`, `observability`.

**Mapping RHDH mount points to entity content groups:**

| RHDH mount point prefix | Typical `group` value |
| --- | --- |
| `entity.page.overview` | `overview` |
| `entity.page.docs` | `documentation` |
| `entity.page.ci`, `entity.page.cd`, `entity.page.kubernetes`, etc. | `development` or `deployment` |
| Custom `entity.page.my-new-tab` | Custom group id in `page:catalog/entity` `groups` config |

**Notes:**

- RHDH `entityTabs` created mount point namespaces dynamically. In the new system, you define content extensions and assign them to groups explicitly.
- Negative `priority` to hide tabs maps to `group: false` on content extensions or disabling groups in `page:catalog/entity` config.

---

### Translation resources (`translationResources`)

**RHDH wiring:**

```yaml
translationResources:
  - importName: myTranslationRef
```

**New approach — plugin code:**

> **Important:** Translations target the `app` plugin, not your plugin. Wrap `TranslationBlueprint` in `createFrontendModule({ pluginId: 'app' })` and export the module separately. Placing translations in your plugin's own `extensions` array will silently fail.

```tsx
import { TranslationBlueprint } from '@backstage/plugin-app-react';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { myTranslationRef } from './translation';

const myTranslations = TranslationBlueprint.make({
  params: {
    resource: myTranslationRef,
  },
});

export const myTranslationsModule = createFrontendModule({
  pluginId: 'app',
  extensions: [myTranslations],
});
```

Export the module as a named export alongside the default plugin export in `src/alpha.tsx`.

#### Auto-discovery via separate entry point

Modules targeting `pluginId: 'app'` are not auto-discovered by `app.packages: all` because they are not part of `createFrontendPlugin`. To make them auto-discoverable without explicit code changes in the consuming app, re-export the module as a **default export** from a separate file and add it as its own entry point in `package.json`:

```tsx
// src/myTranslationsModuleExport.ts
export { myTranslationsModule as default } from './index';
```

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./alpha": "./src/alpha.tsx",
    "./my-translations-module": "./src/myTranslationsModuleExport.ts",
    "./package.json": "./package.json"
  }
}
```

Module federation treats each entry point as a separate remote. This lets the Backstage app load the module automatically without adding it to the `features` array. This pattern works for any `createFrontendModule` that targets a different plugin (init logic, translations, etc.). See the [quickstart plugin](https://github.com/redhat-developer/rhdh-plugins/tree/main/workspaces/quickstart/plugins/quickstart) for a real example.

**Adopter configuration:** Override messages via additional `TranslationBlueprint` extensions or JSON translation resources attached to the app.

See [Migrating Apps — Translations](https://backstage.io/docs/frontend-system/building-apps/migrating/#translations).

---

### Provide additional Utility APIs (`apiFactories`)

**RHDH wiring (explicit):**

```yaml
apiFactories:
  - importName: customScmAuthApiFactory
```

**RHDH wiring (implicit):** Export `createPlugin` from `PluginRoot` — APIs auto-register.

**New approach — plugin code:**

```tsx
const customScmAuthApi = ApiBlueprint.make({
  params: defineParams =>
    defineParams({
      api: scmAuthApiRef,
      deps: { githubAuthApi: githubAuthApiRef },
      factory: ({ githubAuthApi }) => ScmAuth.forGithub(githubAuthApi),
    }),
});
```

APIs attach to the `app` extension `apis` input and are auto-discovered when the plugin is installed.

**Adopter configuration (override API behavior):**

```yaml
app:
  extensions:
    - api:core.auth.github:
        config:
          # extension-specific config when supported
```

To replace an API implementation entirely, use [extension overrides](https://backstage.io/docs/frontend-system/architecture/extension-overrides/) in a frontend module.

**Notes:**

- Empty `dynamicPlugins.frontend.my-package: {}` is no longer needed — installing the plugin dependency is sufficient.
- API ref IDs map to extension IDs: `api:<api-ref-id-with-dots-as-slashes>` (see [Configuring Utility APIs](https://backstage.io/docs/frontend-system/utility-apis/configuring/)).

---

### Adding custom authentication provider settings (`providerSettings`)

**RHDH wiring:**

```yaml
providerSettings:
  - title: My Custom Auth Provider
    description: Sign in using My Custom Auth Provider
    provider: core.auth.my-custom-auth-provider
```

**New approach — plugin code:**

Attach a provider settings UI element to the user-settings auth sub-page:

```tsx
import { createExtension } from '@backstage/frontend-plugin-api';
import { coreExtensionData } from '@backstage/frontend-plugin-api';
import { ProviderSettingsItem } from '@backstage/plugin-user-settings';

const myProviderSettings = createExtension({
  kind: 'auth-provider-settings',
  name: 'my-custom',
  attachTo: { id: 'sub-page:user-settings/auth-providers', input: 'providerSettings' },
  output: [coreExtensionData.reactElement],
  factory: () => [
    coreExtensionData.reactElement(
      <ProviderSettingsItem
        provider="my-custom-auth-provider"
        apiRef={myCustomAuthApiRef}
        title="My Custom Auth Provider"
        description="Sign in using My Custom Auth Provider"
      />,
    ),
  ],
});
```

Also provide `ApiBlueprint` for the auth API and `SignInPageBlueprint` if needed.

---

### Use a custom SignInPage component (`signInPage`)

**RHDH wiring:**

```yaml
signInPage:
  importName: CustomSignInPage
```

**New approach — plugin code:**

```tsx
import { SignInPageBlueprint } from '@backstage/plugin-app-react';

const customSignInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => {
      const { CustomSignInPage } = await import('./CustomSignInPage');
      return CustomSignInPage;
    },
  },
});
```

**Notes:**

- Only one sign-in page extension can be active. Installing multiple replaces based on extension override rules.
- Do not statically import the sign-in component in the same file as the blueprint — the `loader` must be the only reference (see [Keep the NFS entry lightweight](#keep-the-nfs-entry-lightweight-lazy-loading)).
- See [Migrating Apps — Sign-in page](https://backstage.io/docs/frontend-system/building-apps/migrating/).

---

### Provide custom Scaffolder field extensions (`scaffolderFieldExtensions`)

**RHDH wiring:**

```yaml
scaffolderFieldExtensions:
  - importName: MyNewFieldExtension
```

**New approach — plugin code:**

```tsx
import { FormFieldBlueprint } from '@backstage/plugin-scaffolder-react/alpha';

export const myField = FormFieldBlueprint.make({
  name: 'MyCustomField',
  params: {
    schema: { /* JSON schema fragment */ },
    loader: async () => {
      const { MyCustomField } = await import('./MyCustomField');
      return MyCustomField;
    },
  },
});
```

Fields are auto-discovered via `formFieldsApiRef` when the plugin is installed. No YAML registration required.

**Adopter configuration:** None for registration. Template authors use the field name in `template.yaml` as before.

---

### Provide custom TechDocs addons

**RHDH wiring:**

```yaml
techdocsAddons:
  - importName: ExampleAddon
    config:
      props: ...
```

This is the legacy dynamic-plugin wiring format. It remains available for legacy plugins, but it is not used by the new frontend system.

**New approach — plugin code:**

```tsx
import { AddonBlueprint } from '@backstage/plugin-techdocs-react/alpha';

const exampleAddon = AddonBlueprint.make({
  name: 'example',
  params: {
    name: 'ExampleAddon',
    location: TechDocsAddonLocations.Content,
    component: ExampleTestAddon,
  },
});
```

Addons are collected via `techdocsAddonsApiRef` and merged into TechDocs reader and entity content extensions automatically.

For dynamic plugins, export each addon as an individual package subpath whose default export is a `FrontendModule`. The addon is then enabled or disabled using its NFS extension ID in `app.extensions`:

```yaml
app:
  extensions:
    - addon:techdocs/example: false
```

The contributed TechDocs addon package uses these extension IDs:

- `addon:techdocs/expandable-navigation`
- `addon:techdocs/report-issue`
- `addon:techdocs/text-size`
- `addon:techdocs/light-box`

**Notes:**

- The older pattern of injecting addons through `staticJSXContent` in dynamic plugin exports (see [Export Derived Package](export-derived-package.md)) is specific to the legacy dynamic plugin host. Prefer `AddonBlueprint` for new development.
- The `app.extensions` entries configure extensions that the package exports; they do not replace the package's individual NFS subpath exports.

---

### Add a custom Backstage theme or replace the provided theme (`themes`)

**RHDH wiring:**

```yaml
themes:
  - id: light
    title: Light
    variant: light
    icon: someIconReference
    importName: lightThemeProvider
```

**New approach — plugin code:**

```tsx
import { ThemeBlueprint } from '@backstage/plugin-app-react';
import { lightTheme } from './lightTheme';

const customLightTheme = ThemeBlueprint.make({
  name: 'light',
  params: {
    theme: lightTheme,
    title: 'Light',
    variant: 'light',
    icon: <LightIcon />,
  },
});
```

Use `name: 'light'` or `name: 'dark'` to override the built-in themes.

**Adopter configuration:**

```yaml
app:
  extensions:
    - theme:my-plugin/light:
        config:
          title: Corporate Light
```

---

## Operator configuration

YAML-only customization (disable a card, reorder tabs, rename nav items, and so on) is documented in [Migrating Config to the New Frontend System](migrating-config-to-new-frontend-system.md). Plugin authors should still understand that adopters will use `app.extensions` for overrides once plugins export `/alpha` extensions.

---

## Dynamic plugin export considerations

When continuing to ship OCI dynamic plugin images during migration:

### Legacy `scalprum` configuration in `package.json`

Legacy RHDH frontend dynamic plugins are built as a Webpack module-federation container. The RHDH CLI reads a `scalprum` section in the derived package's `package.json` to control the container name and which source files are exposed as entrypoints. See [Export Derived Dynamic Plugin Package](export-derived-package.md) for the full export workflow.

Default configuration (often generated by the CLI when none is present):

```json
{
  "scalprum": {
    "name": "<package_name>",
    "exposedModules": {
      "PluginRoot": "./src/index.ts"
    }
  }
}
```

| Field | Purpose |
| --- | --- |
| `scalprum.name` | Webpack container name. This is also the key used under `dynamicPlugins.frontend` in operator configuration — it may differ from the npm package name if you customize it. |
| `scalprum.exposedModules` | Maps **module names** to source entrypoints. Each key becomes a loadable entrypoint in the dynamic plugin bundle. |

Legacy [Frontend Plugin Wiring](frontend-plugin-wiring.md) references these modules:

- `module` — optional; selects which `exposedModules` key to load (defaults to `PluginRoot`).
- `importName` — optional; which named export to render from that module (defaults to the module's default export).

Example with multiple exposed modules:

```json
{
  "scalprum": {
    "name": "custom-package-name",
    "exposedModules": {
      "PluginRoot": "./src/index.ts",
      "FooModuleName": "./src/foo.ts"
    }
  }
}
```

Corresponding legacy wiring:

```yaml
dynamicPlugins:
  frontend:
    custom-package-name:
      mountPoints:
        - mountPoint: entity.page.overview/cards
          module: FooModuleName
          importName: MyCard
```

**During migration:** keep `scalprum` configuration working for any deployment still on the legacy frontend host. Add a `./alpha` export in `package.json` for the new frontend system. The new path does not use `importName` / `module` in operator YAML — extensions are registered by the `createFrontendPlugin` default export from `./alpha`.

You can customize `scalprum` in `package.json` directly or via the CLI `--scalprum-config` option (see [export-derived-package.md](export-derived-package.md)).

### Export checklist

1. **Dual exports:** Keep legacy `scalprum.exposedModules` (typically `PluginRoot` → `src/index.ts`) during transition; add `./alpha` for the new frontend system.
2. **Import names in YAML:** Legacy wiring uses `importName` and optional `module` to resolve exports from `exposedModules`. New frontend system plugins are self-describing — the `./alpha` export registers extensions without per-feature YAML wiring.
3. **Reduce YAML surface:** As you migrate each feature to extensions in plugin code, delete the corresponding `dynamicPlugins.frontend` keys from `pluginConfig` in `dynamic-plugins.yaml`. Fewer moving parts means fewer export-time surprises.
4. Re-export with a CLI version from the [version matrix](versions.md).

---

## Verification checklist

Use this checklist before declaring migration complete:

- [ ] Legacy `scalprum.exposedModules` still resolves all `importName` / `module` references used in existing operator config (during dual-export period)
- [ ] `src/alpha.tsx` exports `createFrontendPlugin` as default from `./alpha`
- [ ] All former `dynamicRoutes` are `PageBlueprint` / `SubPageBlueprint` extensions
- [ ] All former `mountPoints` map to the correct blueprint (`EntityCard`, `EntityContent`, `SearchResultListItem`, etc.)
- [ ] `externalRoutes` declared on plugin; app-level bindings documented for adopters
- [ ] APIs migrated to `ApiBlueprint` (no `apiFactories` YAML needed)
- [ ] Scaffolder fields use `FormFieldBlueprint` (if applicable)
- [ ] TechDocs addons use `AddonBlueprint` (if applicable)
- [ ] Themes / translations use `ThemeBlueprint` / `TranslationBlueprint` (if applicable)
- [ ] Sign-in and provider settings use `SignInPageBlueprint` / auth settings extensions (if applicable)
- [ ] Plugin works when added as dependency to `packages/app` with `app.packages: all`
- [ ] Adopter overrides tested via `app.extensions` (title, filter, disable)
- [ ] NFS entry has no static imports of page routers, layouts, or heavy UI; loaders use real `import()`
- [ ] Sync vs async chunks reviewed in `mf-manifest.json` after `yarn backstage-cli package bundle` (see [Validate sync vs async chunks](#validate-sync-vs-async-chunks))
- [ ] Dynamic plugin OCI image rebuilt and smoke-tested in RHDH (if still distributing as dynamic plugin)

---

## Common migration gotchas

### `ApiBlueprint.make` requires a `defineParams` wrapper

`ApiBlueprint.make` expects a callback wrapping `createApiFactory(...)`. Passing a plain params object will not work:

```tsx
// Wrong
ApiBlueprint.make({
  params: { api: myApiRef, deps: {...}, factory: (...) => ... },
});

// Correct
ApiBlueprint.make({
  params: defineParams => defineParams(
    createApiFactory({ api: myApiRef, deps: {...}, factory: (...) => ... })
  ),
});
```

### Double headers in pages

Legacy page components include `PageWithHeader` or `Page` + `Header`. In the new frontend system, the framework provides the header via `PageLayout`. Using both produces double headers. Create an NFS variant without the page shell:

```tsx
export function MyPage() {
  return <PageWithHeader title="My Plugin" themeId="tool"><Content><MyPageContent /></Content></PageWithHeader>;
}

// NFS variant — content only
export function NfsMyPage() {
  return <Content><MyPageContent /></Content>;
}
```

```tsx
loader: () => import('./components/MyPage').then(m => <m.NfsMyPage />)
```

### Plugin must be the default export

The new frontend system discovers plugins via default imports. A named export will not be picked up:

```tsx
// Wrong
export const myPlugin = createFrontendPlugin({ pluginId: 'my-plugin', ... });

// Correct
export default createFrontendPlugin({ pluginId: 'my-plugin', ... });
```

### Static import inside an async loader is still sync

`loader: async () => <MyPage />` does not lazy-load `MyPage` if `MyPage` was imported with a static `import` at the top of the file. Use `import()` as the only reference to heavy UI from extension definition modules. See [Keep the NFS entry lightweight](#keep-the-nfs-entry-lightweight-lazy-loading).

---

## Reference migration PRs

Real-world migration PRs from the `rhdh-plugins` repository:

| Plugin | PR | What to learn | Complexity |
| --- | --- | --- | --- |
| adoption-insights | [#2309](https://github.com/redhat-developer/rhdh-plugins/pull/2309) | Simple page plugin | Low |
| bulk-import | [#2247](https://github.com/redhat-developer/rhdh-plugins/pull/2247) | Permission-based access | Low-Medium |
| scorecard | [#2487](https://github.com/redhat-developer/rhdh-plugins/pull/2487) | EntityContent + HomePageWidget | Medium |
| orchestrator | [#2526](https://github.com/redhat-developer/rhdh-plugins/pull/2526) | Multiple routes/pages | Medium |
| lightspeed | [#2721](https://github.com/redhat-developer/rhdh-plugins/pull/2721) | Drawer + FAB (RHDH-specific) | Medium |
| extensions | [#2527](https://github.com/redhat-developer/rhdh-plugins/pull/2527) | `compatWrapper` usage | Medium |
| homepage | [#2423](https://github.com/redhat-developer/rhdh-plugins/pull/2423) | HomePageWidgets | Medium |
| quickstart | [#2842](https://github.com/redhat-developer/rhdh-plugins/pull/2842) | Drawer + GlobalHeaderMenuItem | Medium-High |

---

## RHDH-specific features without upstream equivalents (yet)

| Feature | Status |
| --- | --- |
| Nested sidebar menu groups (`menuItems.parent`) | RHDH dynamic plugins only — use `NavContentBlueprint` for custom nav upstream |
| Application drawer mount points | `AppDrawerContentBlueprint` in `@red-hat-developer-hub/backstage-plugin-app-react/alpha` — see [drawer section](#adding-application-drawers-applicationinternaldrawer-) |
| `global.header/help` and similar RHDH header slots | Being migrated in `rhdh-plugins` global-header workspace |
| RHDH `mountPoints[].config.layout` grid SX | Implement in component CSS or card wrapper |
| `staticJSXContent` dynamic plugin pattern | Legacy dynamic host — replace with extension inputs / Utility APIs |

---

## Further reading

### RHDH documentation

- [Migrating Config to the New Frontend System](migrating-config-to-new-frontend-system.md) — operator guide for YAML customization
- [Frontend Plugin Wiring](frontend-plugin-wiring.md) — legacy RHDH dynamic plugin configuration reference
- [Export Derived Dynamic Plugin Package](export-derived-package.md)
- [Installing Plugins](installing-plugins.md)
- [Version Compatibility Matrix](versions.md)

### Backstage new frontend system

- [Frontend System Introduction](https://backstage.io/docs/frontend-system/)
- [Migrating Plugins](https://backstage.io/docs/frontend-system/building-plugins/migrating/)
- [Migrating Apps](https://backstage.io/docs/frontend-system/building-apps/migrating/)
- [Configuring Extensions](https://backstage.io/docs/frontend-system/building-apps/configuring-extensions/)
- [Common Extension Blueprints](https://backstage.io/docs/frontend-system/building-plugins/common-extension-blueprints/)
- [Example `app-config.yaml`](https://github.com/backstage/backstage/blob/master/app-config.yaml)
