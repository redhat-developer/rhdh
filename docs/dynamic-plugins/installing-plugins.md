# Installing Plugins

To install a dynamic plugin, you need to add the plugin definition to the `dynamic-plugin-config.yaml` file.

The placement of `dynamic-plugin-config.yaml` depends on the deployment method.
For more information, see [Installing Dynamic Plugins with the Red Hat Developer Hub Operator](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.3/html/installing_and_viewing_dynamic_plugins/index#proc-config-dynamic-plugins-rhdh-operator_title-plugins-rhdh-about) or [Installing Dynamic Plugins Using the Helm Chart](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.3/html/installing_and_viewing_dynamic_plugins/index#con-install-dynamic-plugin-helm_title-plugins-rhdh-about).

Plugins are defined in the `plugins` array in the `dynamic-plugin-config.yaml` file. Each plugin is defined as an object with the following properties:

- `package`: The package definition of the plugin. This can be an OCI image, `tgz` archive, npm package, or a directory path.
- `disabled`: A boolean value that determines whether the plugin is enabled or disabled.
- `integrity`: The integrity hash of the package. This is required for `tgz` archives and npm packages.
- `pluginConfig`: The configuration for the plugin. For backend plugins this is optional and can be used to pass configuration to the plugin. For frontend this is required, see [Frontend Plugin Wiring](frontend-plugin-wiring.md) for more information on how to configure bindings and routes. This is fragment o the `app-config.yaml` file. Anything that is added to this object will be merged with the main app-config.yaml file.

## Dynamic plugins included in the Showcase container image

The showcase container image is preloaded with a variety of dynamic plugins, the majority of which are initially disabled due to mandatory configuration requirements. The comprehensive list of these plugins is outlined in the [`dynamic-plugins.default.yaml`](https://github.com/redhat-developer/rhdh/blob/main/dynamic-plugins.default.yaml) file.

Upon the application startup, for each plugin disabled by default, the `install-dynamic-plugins` init container within the `backstage` Pod's log will exhibit a line similar to the following:

```console
======= Skipping disabled dynamic plugin ./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-dynamic
```

To activate this plugin, simply add a package with the same name and adjust the `disabled` field.

```yaml
plugins:
  - disabled: false
    package: ./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-dynamic
```

While the plugin's default configuration comes from the `dynamic-plugins.default.yaml` file, you still have the option to replace it by incorporating a `pluginConfig` entry into the plugin configuration.

Note: The plugin's default configuration typically references environment variables, and it is essential to ensure that these variables are set in the Helm chart values or the Operator configuration.

## Installing External Dynamic Plugins

RHDH supports dynamic plugins, which are plugins not included in the core RHDH distribution. These plugins can be installed or uninstalled without rebuilding the RHDH application; only a restart is required to apply the changes.

If your plugin not already packaged as a dynamic plugin, you must package it into one of the supported formats before installation.

Dynamic plugins can be packaged in three formats:

- OCI image
- `tgz` archive
- npm package

You can also load the dynamic plugin from a plain directory, though this is not recommended for production use (expect for the plugins that are already included in the RHDH container image). But this method can be helpful for development and testing.

More information on packaging dynamic plugins can be found in the [Packaging Dynamic Plugins](packaging-dynamic-plugins.md).

### Loading a Plugin from an OCI Image

When defining the plugin packaged as an OCI image, use the `oci://` prefix, followed by the image name, tag, and plugin name separated by the `!` character (`oci://<image-name>:<tag>!<plugin-name>`).

```yaml
plugins:
  - disabled: false
    package: oci://quay.io/example/image:v0.0.1!backstage-plugin-myplugin
```

For private registries, you can set the `REGISTRY_AUTH_FILE` environment variable to the path of the configuration file containing the authentication details for the registry. This file is typically located at `~/.config/containers/auth.json` or `~/.docker/config.json`.

For integrity check one may use [image digest](https://github.com/opencontainers/image-spec/blob/main/descriptor.md#digests), making it possible to refer to the image digest in the dynamic plugin package:

```yaml
plugins:
  - disabled: false
    package: oci://quay.io/example/image@sha256:28036abec4dffc714394e4ee433f16a59493db8017795049c831be41c02eb5dc!backstage-plugin-myplugin
```

### Using a `tgz` Archive

When defining the plugin packaged as a `tgz` archive, use the URL of the archive and the integrity hash of the archive.

```yaml
plugins:
  - disabled: false
    package: https://example.com/backstage-plugin-myplugin-1.0.0.tgz
    integrity: sha512-9WlbgEdadJNeQxdn1973r5E4kNFvnT9GjLD627GWgrhCaxjCmxqdNW08cj+Bf47mwAtZMt1Ttyo+ZhDRDj9PoA==
```

### Using an JavaScript package reference

When defining the plugin packaged as an npm package, use the package name and version, and the integrity hash of the package.

```yaml
plugins:
  - disabled: false
    package: @example/backstage-plugin-myplugin@1.0.0
    integrity: sha512-9WlbgEdadJNeQxdn1973r5E4kNFvnT9GjLD627GWgrhCaxjCmxqdNW08cj+Bf47mwAtZMt1Ttyo+ZhDRDj9PoA==
```

To get the integrity hash of a JavaScript package from the npm registry, use:

```bash
npm view --registry https://example.com:4873/ @backstage-community/plugin-todo-dynamic@0.2.40 dist.integrity
```

#### Using a custom NPM registry

To configure the NPM registry URL and authentication information, you can utilize a `.npmrc` file. When using OpenShift or Kubernetes, you can add this file by creating a secret with the `.npmrc` file content and mounting it into `install-dynamic-plugins` init container.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: dynamic-plugins-npmrc
type: Opaque
stringData:
  .npmrc: |
    registry=<registry-url>
    //<registry-url>:_authToken=<auth-token>
```

When using RHDH Helm Chart you can just name the Secret using following pattern `{{ .Release.Name }}-dynamic-plugins-npmrc`, and it will be mounted automatically. (If you installed RHDH using `helm install rhdh ....` than the secret should be named `rhdh-dynamic-plugins-npmrc`)

When using the Operator ....

//TODO

### Storage of Dynamic Plugins

The directory where dynamic plugins are located is mounted as a volume to the _install-dynamic-plugins_ init container and the _backstage-backend_ container. The _install-dynamic-plugins_ init container is responsible for downloading and extracting the plugins into this directory. Depending on the deployment method, the directory is mounted as an ephemeral or persistent volume. In the latter case, the volume can be shared between several Pods, and the plugins installation script is also responsible for downloading and extracting the plugins only once, avoiding conflicts.

**Important Note:** If _install-dynamic-plugins_ init container was killed with SIGKILL signal (for example in a case of OOM) the script is not able to remove the lock file and the next time the Pod starts, it will be waiting for the lock release. You can see the following message in the logs for all the Pods:

```console
oc logs -n <namespace-name> -f backstage-<backstage-name>-<pod-suffix> -c install-dynamic-plugins
======= Waiting for lock release...
```
In such a case, you can delete the lock file manually from any of the Pods:

```console
oc exec -n <namespace-name> deploy/backstage-<backstage-name> -c install-dynamic-plugins -- rm -f /dynamic-plugins-root/dynamic-plugins.lock
```
