# app-next

## Overview

This package contains the Red Hat Developer Hub (RHDH) frontend application built using Backstage's new frontend system architecture.  The `app-next` package leverages Backstage's new frontend system, which introduces a more modular and extensible architecture compared to the legacy frontend system. This new system is built around the concepts of extensions, plugins, and utility APIs, providing better composability and customization options.

## Development

### Primary Development Workflow

The recommended way to run the new frontend system is using the `backend start:next` command:

```bash
# from the root of the repo
yarn workspace backend start:next
```

### Standalone Development

You can also run the frontend application independently for development:

```bash
# from the root of the repo
yarn workspace app-next start
```

### Other Available Commands

- `yarn build` - Build the application for production
- `yarn test` - Run the test suite
- `yarn lint` - Run linting checks
- `yarn clean` - Clean build artifacts

## Architecture

This application is built using Backstage's [new frontend system](https://backstage.io/docs/frontend-system/architecture/index), which provides:

- **Extension-based architecture**: Modular components that can be composed together
- **Plugin system**: Reusable functionality packages
- **Utility APIs**: Shared services and functionality
- **Route management**: Dynamic routing system for plugin navigation
- **Theming and customization**: Flexible styling and branding options
