# Installing Plugins

To install a dynamic plugin, you need to add the plugin definition to the `dynamic-plugins.yaml` file.

The placement of `dynamic-plugins.yaml` depends on the deployment method.
For more information, see [Installing Dynamic Plugins with the Red Hat Developer Hub Operator](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.7/html/installing_and_viewing_plugins_in_red_hat_developer_hub/rhdh-installing-rhdh-plugins_title-plugins-rhdh-about#proc-config-dynamic-plugins-rhdh-operator_rhdh-installing-rhdh-plugins) or [Installing Dynamic Plugins Using the Helm Chart](https://docs.redhat.com/en/documentation/red_hat_developer_hub/1.7/html/installing_and_viewing_plugins_in_red_hat_developer_hub/rhdh-installing-rhdh-plugins_title-plugins-rhdh-about#con-install-dynamic-plugin-helm_rhdh-installing-rhdh-plugins).

Plugins are defined in the `plugins` array in the `dynamic-plugins.yaml` file. Each plugin is defined as an object with the following properties:

- `package`: The package definition of the plugin. This can be an OCI image, `tgz` archive, npm package, or a directory path. For OCI packages ONLY, the tag or digest can be replaced by the `{{inherit}}` tag (requires the included configuration to contain a valid tag or digest to inherit from)
- `disabled`: A boolean value that determines whether the plugin is enabled or disabled.
- `integrity`: The integrity hash of the package. This is required for `tgz` archives and npm packages.
- `pluginConfig`: The configuration for the plugin. For backend plugins this is optional and can be used to pass configuration to the plugin. For frontend plugins this is required, see [Frontend Plugin Wiring](frontend-plugin-wiring.md) for more information on how to configure bindings and routes. This is a fragment of the `app-config.yaml` file. Anything that is added to this object will be merged into a `app-config.dynamic-plugins.yaml` file whose config can be merged with the main `app-config.yaml` config when launching RHDH.

Note: Duplicate plugins found across config files in the `includes` field will throw an error even if they are disabled. Similarly, duplicate plugin in the `dynamic-plugins.yaml` file will also throw the same error.

## Dynamic plugins included in the RHDH container image

The RHDH container image is preloaded with a variety of dynamic plugins, the majority of which are initially disabled due to mandatory configuration requirements. The comprehensive list of these plugins is outlined in the [`dynamic-plugins.default.yaml`](https://github.com/redhat-developer/rhdh/blob/main/dynamic-plugins.default.yaml) file.

Upon the application startup, for each plugin disabled by default, the `install-dynamic-plugins` init container within the `redhat-developer-hub` pod's log will exhibit a line similar to the following:

```console
======= Skipping disabled dynamic plugin ./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-dynamic
```

To activate this plugin, simply add a package with the same name and adjust the `disabled` field.

```yaml
plugins:
  - disabled: false
    package: ./dynamic-plugins/dist/backstage-plugin-catalog-backend-module-github-dynamic
```

While the plugin's default configuration comes from the `dynamic-plugins.default.yaml` file, you still have the option to override it by incorporating a `pluginConfig` entry into the plugin configuration.

Note: The plugin's default configuration typically references environment variables, and it is essential to ensure that these variables are set in the Helm chart values or the Operator configuration.

## Installing External Dynamic Plugins

RHDH supports external dynamic plugins, which are plugins not included in the core RHDH distribution. These plugins can be installed or uninstalled without rebuilding the RHDH application; only a restart is required to apply the changes.

If your plugin is not already packaged as a dynamic plugin, you must package it into one of the supported formats before installation.

Dynamic plugins can be packaged in three formats:

- OCI image
- `tgz` archive
- npm package

You can also load the dynamic plugin from a plain directory, though this is not recommended for production use (expect for the plugins that are already included in the RHDH container image). But this method can be helpful for development and testing.

More information on packaging dynamic plugins can be found in the [Packaging Dynamic Plugins](packaging-dynamic-plugins.md).

### Loading a Plugin from an OCI Image

When defining the plugin packaged as an OCI image, use the `oci://` prefix, followed by the image name, tag OR digest, and plugin name separated by the `!` character (`oci://<image-name>:<tag>!<plugin-name>`).

```yaml
plugins:
  - disabled: false
    package: oci://quay.io/example/image:v0.0.1!backstage-plugin-myplugin
```

For private registries, you can set the `REGISTRY_AUTH_FILE` environment variable to the path of the configuration file containing the authentication details for the registry. This file is typically located at `~/.config/containers/auth.json` or `~/.docker/config.json`.

For integrity check one may use [image digests](https://github.com/opencontainers/image-spec/blob/main/descriptor.md#digests), making it possible to refer to the image digest in the dynamic plugin package:

```yaml
plugins:
  - disabled: false
    package: oci://quay.io/example/image@sha256:28036abec4dffc714394e4ee433f16a59493db8017795049c831be41c02eb5dc!backstage-plugin-myplugin
```

#### OCI Package Version Inheritance

When working with OCI-packaged dynamic plugins, you may want to avoid specifying the version (tag or digest) in multiple places, especially when including plugins from other configuration files such as `dynamic-plugins.default.yaml`. Setting the tag of the OCI package to `{{inherit}}` allows a plugin configuration override to inherit the plugin version from an included configuration.

Note: The `package` field of the override must have matching `<image-name>` and `<plugin-name>` in `oci://<image-name>:<tag>!<plugin-name>` as the included plugin configuration.

For example, if we have an included dynamic plugin file (`dynamic-plugins.example.yaml`) with `v0.0.2` of our plugin which might be updated to match the current RHDH version:

```yaml
plugins:
  - disabled: true
    package: oci://quay.io/example/image:v0.0.2!backstage-plugin-myplugin
```

and a `dynamic-plugins.yaml` file with the `{{inherit}}` tag using configurations for an older version that is still compatible:

```yaml
includes:
- dynamic-plugins.example.yaml
plugins:
  - disabled: false
    package: oci://quay.io/example/image:{{inherit}}!backstage-plugin-myplugin
    pluginConfig:
      exampleName: "test"
```

Then the resolved version for the dynamic plugin would be `v0.0.2` but the overridden `pluginConfig` and `disabled: false` would still apply.

Note: An error will be thrown if you use `{{inherit}}` in the `includes` plugin configuration(s). A similar error will be thrown if `{{inherit}}` is used in `dynamic-plugins.yaml` when there is not already an existing plugin configuration in the `includes` plugin configuration(s).

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

The directory where dynamic plugins are located is mounted as a volume to the `install-dynamic-plugins` init container and the `backstage-backend` container. The `install-dynamic-plugins` init container is responsible for downloading and extracting the plugins into this directory. Depending on the deployment method, the directory is mounted as an ephemeral or persistent volume. In the latter case, the volume can be shared between several Pods, and the plugins installation script is also responsible for downloading and extracting the plugins only once, avoiding conflicts.

**Important Note:** If `install-dynamic-plugins` init container was killed with SIGKILL signal, which may happen due to the following reasons:

- pod eviction (to free up node resources)
- pod deletion (if not terminated with SIGTERM within graceful period)
- node shutdown
- container runtime issues
- exceeding resource limits (OOM for example)

Then the script will not be able to remove the lock file, so the next time the pod starts, it will be be stuck waiting for the lock to release. You will see the following message in the logs for the init `install-dynamic-plugins` container:

```console
oc logs -n <namespace-name> -f backstage-<backstage-name>-<pod-suffix> -c install-dynamic-plugins
======= Waiting for lock release (file: /dynamic-plugins-root/install-dynamic-plugins.lock)...
```

In such a case, you can delete the lock file manually from any of the Pods:

```console
oc exec -n <namespace-name> deploy/backstage-<backstage-name> -c install-dynamic-plugins -- rm -f /dynamic-plugins-root/dynamic-plugins.lock
```
