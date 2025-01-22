# Wrapping a third-party backend plugin to add dynamic plugin support

Unless you need to include plugin in the default RHDH container image, or you need to make some changes in the plugin source code, you don't need to wrap the plugin.
You can just [export](export-derived-package.md) plugin as a dynamic plugin and install it as described in the [Installing External Dynamic Plugins](installing-plugins.md#installing-external-dynamic-plugins) guide.

In order to add dynamic plugin support to a third-party backend plugin, without touching the third-party plugin source code, a wrapper plugin can be created that will:

- import the third-party plugin as a dependency.
- reexport the third-party plugin in `src/index.ts` via `export {default} from '<package_name>'`,
- export it as a dynamic plugin.

Examples of such a wrapper plugins can be found in the [Janus showcase repository](https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers). For example, [roadiehq-scaffolder-backend-module-utils-dynamic](https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers/roadiehq-scaffolder-backend-module-utils-dynamic) wraps the `@roadiehq/scaffolder-backend-module-utils` package to make it compatible with the dynamic plugin support. It then embeds the wrapped plugin code in the generated code and hoist its `@backstage` dependencies as peer dependencies in the resulting dynamic plugin through the use of the `--embed-package` option in the [`export-dynamic` script](https://github.com/redhat-developer/rhdh/blob/main/dynamic-plugins/wrappers/roadiehq-scaffolder-backend-module-utils-dynamic/package.json#L26).
