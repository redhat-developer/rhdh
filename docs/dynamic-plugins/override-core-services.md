# Overriding Core Backend Service Configuration

## Overview

The Backstage backend platform consists of a number of core services that are well encapsulated.  The configuration of these core services is normally done by directly customizing the backend source code and rebuilding. However, the dynamic plugin functionality adds the ability for core service customization via installing it as a `BackendFeature`.  The Developer Hub backend normally installs all of these default core services statically during initialization.  Environment variables can configure the backend to avoid statically installing a given default core service, allowing for dynamic plugin installation.

## An Example

Some use cases may be easier solved at a lower level service than what's available in the Backstage backend plugin API.  Adding a middleware function to handle all incoming requests can be done by installing a custom `configure` function for the root HTTP router backend service, which allows access to the underlying Express app.

```typescript
// Create the BackendFeature
export const customRootHttpServerFactory: BackendFeature =
  rootHttpRouterServiceFactory({
    configure: ({ app, routes, middleware, logger }) => {
      logger.info(
        'Using custom root HttpRouterServiceFactory configure function',
      );
      app.use(middleware.helmet());
      app.use(middleware.cors());
      app.use(middleware.compression());
      app.use(middleware.logging());
      // Add a the custom middleware function before all
      // of the route handlers
      app.use(addTestHeaderMiddleware({ logger }));
      app.use(routes);
      app.use(middleware.notFound());
      app.use(middleware.error());
    },
  });

// Export the BackendFeature as the default entrypoint
export default customRootHttpServerFactory;
```

This `BackendFeature` overrides the default HTTP router service factory.  Because this is overriding the default implementation of a core service, the above example would need the `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE` environment variable set to `true` so that the Developer Hub does not install the default implementation automatically.

## Override Environment Variables

To allow a dynamic plugin to load a core service override, start the Developer Hub backend with the environment variable set that corresponds with the core service ID to be overridden.  Here is a list of the available environment variables and core service IDs:

- `ENABLE_CORE_AUTH_OVERRIDE` - allow overriding the `core.auth` service
- `ENABLE_CORE_CACHE_OVERRIDE` - allow overriding the `core.cache` service
- `ENABLE_CORE_ROOTCONFIG_OVERRIDE` - allow overriding the `core.rootConfig` service
- `ENABLE_CORE_DATABASE_OVERRIDE` - allow overriding the `core.database` service
- `ENABLE_CORE_DISCOVERY_OVERRIDE` - allow overriding the `core.discovery` service
- `ENABLE_CORE_HTTPAUTH_OVERRIDE` - allow overriding the `core.httpAuth` service
- `ENABLE_CORE_HTTPROUTER_OVERRIDE` - allow overriding the `core.httpRouter` service
- `ENABLE_CORE_LIFECYCLE_OVERRIDE` - allow overriding the `core.lifecycle` service
- `ENABLE_CORE_LOGGER_OVERRIDE` - allow overriding the `core.logger` service
- `ENABLE_CORE_PERMISSIONS_OVERRIDE` - allow overriding the `core.permissions` service
- `ENABLE_CORE_ROOTHEALTH_OVERRIDE` - allow overriding the `core.rootHealth` service
- `ENABLE_CORE_ROOTHTTPROUTER_OVERRIDE` - allow overriding the `core.rootHttpRouter` service
- `ENABLE_CORE_ROOTLIFECYCLE_OVERRIDE` - allow overriding the `core.rootLifecycle` service
- `ENABLE_CORE_SCHEDULER_OVERRIDE` - allow overriding the `core.scheduler` service
- `ENABLE_CORE_USERINFO_OVERRIDE` - allow overriding the `core.userInfo` service
- `ENABLE_CORE_URLREADER_OVERRIDE` - allow overriding the `core.urlReader` service
- `ENABLE_EVENTS_SERVICE_OVERRIDE` - allow overriding the `events.service` service

## Overriding the provided authentication module

Developer Hub ships with an opinionated authentication module setup that supports many use-cases.  However it is also possible to disable this authentication module entirely and compose an authentication solution from a set of dynamic frontend and backend plugins.  This requires disabling the provided authentication module so it doesn't conflict with any custom authentication configuration.

- `ENABLE_AUTH_PROVIDER_MODULE_OVERRIDE` - set to "true" to disable the Developer Hub provided backend authentication module
