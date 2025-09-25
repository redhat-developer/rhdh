# Dynamic Plugins

RHDH supports dynamic plugins, which are plugins not included in the core RHDH distribution. These plugins can be installed or uninstalled without rebuilding the RHDH application; only a restart is required to apply the changes.

The dynamic plugin support is based on the [backend plugin manager package](https://github.com/backstage/backstage/tree/master/packages/backend-dynamic-feature-service), which is a service that scans a configured root directory (`dynamicPlugins.rootDirectory` in the app config) for dynamic plugin packages, and loads them dynamically.

Dynamic plugin support is based on Dynamic plugin derived packages.
This is a special JavaScript package that is derived from an original plugin package source code.
You can find more information about process of creating derived packages in the [Export Derived Dynamic Plugin Package](export-derived-package.md) document.
<!-- markdown-link-check-disable-next-line -->
The dynamic plugin derived packages shouldn't be pushed into the [public npm registry](https://www.npmjs.com), but it can be published to a private or internal npm registry.
More details about publishing dynamic plugins is in the [Packaging Dynamic Plugins](packaging-dynamic-plugins.md) document.

## Table of Contents

[Export Derived Dynamic Plugin Package](export-derived-package.md)

[Packaging and Publishing Backstage Plugin as a Dynamic Plugin](packaging-dynamic-plugins.md)

[Installing Plugins](installing-plugins.md)

[Frontend Plugin Wiring](frontend-plugin-wiring.md)

[Local configuration (for development only)](local.md)

[Version Compatibility Matrix](versions.md)

[Debugging Dynamic Plugins](debugging.md)

[Wrapping a third-party backend plugin to add dynamic plugin support](wrapping-plugins.md)

[Examples](examples.md)

## Installing external Backstage plugins into RHDH

1. Get the source code of the plugin.
2. [Export](export-derived-package.md) the selected plugin as a derived dynamic plugin package.
3. [Package and publish](packaging-dynamic-plugins.md) the derived dynamic plugin package.
4. [Install](installing-plugins.md) the plugin in the RHDH. If plugin is frontend plugin you need to wire it by [defining mount points, dynamic routes, etc](frontend-plugin-wiring.md).

Example of this process on the [todo](https://github.com/backstage/community-plugins/tree/main/workspaces/todo/plugins) plugin from Backstage community plugins:

1. Getting the plugin source code

    ```console
    $ git clone https://github.com/backstage/community-plugins
    $ cd community-plugins/workspaces/todo
    $ yarn install
    $ yarn tsc
    ```

2. Export the backend and frontend plugins

    Export backend plugin.

    ```console
    $ cd plugins/todo-backend
    $ npx @red-hat-developer-hub/cli@latest plugin export
    Building main package
      executing     yarn build ✔
    Packing main package to dist-dynamic/package.json
    Customizing main package in dist-dynamic/package.json for dynamic loading
      moving @backstage/backend-common to peerDependencies
      moving @backstage/backend-openapi-utils to peerDependencies
      moving @backstage/backend-plugin-api to peerDependencies
      moving @backstage/catalog-client to peerDependencies
      moving @backstage/catalog-model to peerDependencies
      moving @backstage/config to peerDependencies
      moving @backstage/errors to peerDependencies
      moving @backstage/integration to peerDependencies
      moving @backstage/plugin-catalog-node to peerDependencies
    Installing private dependencies of the main package
       executing     yarn install --no-immutable ✔
    Validating private dependencies
    Validating plugin entry points
    Saving self-contained config schema in /Users/user/Code/community-plugins/workspaces/todo/plugins/todo-backend/dist-dynamic/dist/configSchema.json

    ```

    Export frontend plugin.

    ```console
    $ cd ../todo
    $ npx @red-hat-developer-hub/cli@latest plugin export
    No scalprum config. Using default dynamic UI configuration:
    {
      "name": "backstage-community.plugin-todo",
      "exposedModules": {
        "PluginRoot": "./src/index.ts"
      }
    }
    If you wish to change the defaults, add "scalprum" configuration to plugin "package.json" file, or use the '--scalprum-config' option to specify an external config.
    Packing main package to dist-dynamic/package.json
    Customizing main package in dist-dynamic/package.json for dynamic loading
    Generating dynamic frontend plugin assets in /Users/user/Code/community-plugins/workspaces/todo/plugins/todo/dist-dynamic/dist-scalprum
      263.46 kB  dist-scalprum/static/1417.d5271413.chunk.js
    ...
    ...
    ...
      250 B      dist-scalprum/static/react-syntax-highlighter_languages_highlight_plaintext.0b7d6592.chunk.js
    Saving self-contained config schema in /Users/user/Code/community-plugins/workspaces/todo/plugins/todo/dist-dynamic/dist-scalprum/configSchema.json
    ```

3. Package and publish the derived dynamic plugin package as the OCI image

    Build OCI image locally.

    ```console
    $ cd ../..
    $ #we should be in workspaces/todo
    $ npx @red-hat-developer-hub/cli@latest plugin package --tag quay.io/user/backstage-community-plugin-todo:v0.1.1
      executing     podman --version ✔
    Using existing 'dist-dynamic' directory at plugins/todo
    Using existing 'dist-dynamic' directory at plugins/todo-backend
    Copying 'plugins/todo/dist-dynamic' to '/var/folders/5c/67drc33d0018j6qgtzqpcsbw0000gn/T/package-dynamic-pluginsmcP4mU/backstage-community-plugin-todo
    No plugin configuration found at undefined create this file as needed if this plugin requires configuration
    Copying 'plugins/todo-backend/dist-dynamic' to '/var/folders/5c/67drc33d0018j6qgtzqpcsbw0000gn/T/package-dynamic-pluginsmcP4mU/backstage-community-plugin-todo-backend-dynamic
    No plugin configuration found at undefined create this file as needed if this plugin requires configuration
    Writing plugin registry metadata to '/var/folders/5c/67drc33d0018j6qgtzqpcsbw0000gn/T/package-dynamic-pluginsmcP4mU/index.json'
    Creating image using podman
      executing     echo "from scratch
    COPY . .
    " | podman build --annotation com.redhat.rhdh.plugins='[{"backstage-community-plugin-todo":{"name":"@backstage-community/plugin-todo","version":"0.2.40","description":"A Backstage plugin that lets you browse TODO comments in your source code","backstage":{"role":"frontend-plugin","pluginId":"todo","pluginPackages":["@backstage-community/plugin-todo","@backstage-community/plugin-todo-backend"]},"homepage":"https://backstage.io","repository":{"type":"git","url":"https://github.com/backstage/community-plugins","directory":"workspaces/todo/plugins/todo"},"license":"Apache-2.0"}},{"backstage-community-plugin-todo-backend-dynamic":{"name":"@backstage-community/plugin-todo-backend","version":"0.3.19","description":"A Backstage backend plugin that lets you browse TODO comments in your source code","backstage":{"role":"backend-plugin","pluginId":"todo","pluginPackages":["@backstage-community/plugin-todo","@backstage-community/plugin-todo-backend"]},"homepage":"https://backstage.io","repository":{"type":"git","url":"https://github.com/backstage/community-plugins","directory":"workspaces/todo/plugins/todo-backend"},"license":"Apache-2.0"}}]' -t 'quay.io/user/backstage-community-plugin-todo:v0.1.1' -f - .
        ✔
    Successfully built image quay.io/user/backstage-community-plugin-todo:v0.1.1 with following plugins:
      backstage-community-plugin-todo
      backstage-community-plugin-todo-backend-dynamic

    Here is an example dynamic-plugins.yaml for these plugins:

    plugins:
      - package: oci://quay.io/user/backstage-community-plugin-todo:v0.1.1!backstage-community-plugin-todo
        disabled: false
      - package: oci://quay.io/user/backstage-community-plugin-todo:v0.1.1!backstage-community-plugin-todo-backend-dynamic
        disabled: false
    ```

    Push image to container registry.

    ```console
    $ podman push quay.io/user/backstage-community-plugin-todo:v0.1.1
    Getting image source signatures
    Copying blob sha256:86a372c456ae6a7a305cd464d194aaf03660932efd53691998ab3403f87cacb5
    Copying config sha256:3b7f074856ecfbba95a77fa87cfad341e8a30c7069447de8144aea0edfcb603e
    Writing manifest to image destination
    ```

4. Install and configure plugins

    Add plugins defintion to the `dynamic-plugins.yaml` file.

    ```yaml
    # frontend and backend plugins for the todo plugin
    - package: oci://quay.io/user/backstage-community-plugin-todo:v0.1.1!backstage-community-plugin-todo
      disabled: false
      pluginConfig:
        dynamicPlugins:
          frontend:
            backstage-community.plugin-todo:
              mountPoints:
                - mountPoint: entity.page.todo/cards
                  importName: EntityTodoContent
              entityTabs:
                - path: /todo
                  title: Todo
                  mountPoint: entity.page.todo
    - package: oci://quay.io/user/backstage-community-plugin-todo:v0.1.1!backstage-community-plugin-todo-backend-dynamic
      disabled: false
    ```


## Enabling plugins included in RHDH container image

RHDH container image includes a set of plugins that are not enabled by default.
You can find more information about how to enable those plugins in the [Dynamic plugins included in the Showcase container image](installing-plugins.md#dynamic-plugins-included-in-the-showcase-container-image) document.


