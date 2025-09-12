
# Debugging Dynamic Plugins

## Backend Dynamic Plugins Local Debug

For local debugging of Dynamic Plugins you need to clone `rhdh`, run it with debugging enabled and attach your IDE debugger to the backend process. First it is required to build and copy the dynamic plugin:

* Build your plugin and export the dynamic package

```shell
cd ${pluginRootDir}
yarn build && yarn run export-dynamic
```

* Copy the resulting `dist-dynamic` directory to dynamic-plugins-root/${plugin-id}

Once the plugin is built and deployed, it is time to prepare the showcase to run it debug mode:

* Go to `rhdh` root directory;
* Run `yarn workspace backend start --inspect`
* In logs you should see something like the following:

```text
Debugger listening on ws://127.0.0.1:9229/9299bb26-3c32-4781-9488-7759b8781db5
```

* The application will be accessible from `http://localhost:7007`. You may start the front end by running the following command from the root directory: `yarn start --filter=app`. It will be available in `http://localhost:3000`
<!-- markdown-link-check-disable-next-line -->
* Attach your IDE debugger to the backend process. This step may depend on the IDE that you are using. For example, if you are using VS Code you may want to check [Node.js debugging in VS Code](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
* Add Breakpoints to the files in folder `dynamic-plugins-root/${plugin-id}`. Optionally you can configure your IDE to add the source maps for the plugin so you can debug the TypeScript code directly and not the compiled JavaScript files

## Backend Dynamic Plugins Container Debug

It is possible to run RHDH on a container and debug plugins that are running on it. In this case you don't need to clone the `rhdh` code locally, instead you must make sure that the running container has the [Node.js debug](https://nodejs.org/en/learn/getting-started/debugging) port open and exposed to the host machine. These are the steps to debug backend dynamic plugins on a container:

* Create directory `dynamic-plugins-root`
* Build your plugin and copy the folder `dist-dynamic` to `dynamic-plugins-root`

```shell
yarn build && yarn export-dynamic
cp ${yourPluginRootDir}/dist-dynamic ./dynamic-plugins-root/${pluginID}
```

* Start the container and make sure to share the plugins directory with it, allow inspection and open the debug port. Here's a sample command tested on RHDH container image version 1.3:

```shell
podman run \
  -v ./dynamic-plugins-root:/opt/app-root/src/dynamic-plugins-root:Z \
  -v ./app-config.local.yaml:/opt/app-root/src/app-config.local.yaml:Z \
  -p 7007:7007 \
  -p 9229:9229 \
  -e NODE_OPTIONS=--no-node-snapshot \
  --entrypoint='["node", "--inspect=0.0.0.0:9229", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.example.yaml", "--config", "app-config.local.yaml"]' \
  quay.io/rhdh/rhdh-hub-rhel9:1.3
```

You should be able to debug from your IDE by attaching it to the process running on port `9229` or selecting it from a list of processes detected by the IDE.

## Frontend Dynamic Plugins Debug

Front end plugins can be debugged directly on your browser, just make sure to export the sources map. When running the plugin on the browser open the Developer Tools and you should be able to visualize the source code and place breakpoints.
