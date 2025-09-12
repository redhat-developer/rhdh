
# Packaging and Publishing Backstage Plugin as a Dynamic Plugin

To package a Backstage plugin as a dynamic plugin, you need access to its source code.

First you need to create a derived package using the `@red-hat-developer-hub/cli` and then package it into one of the supported formats.
For detailed instructions on creating a derived package, see [Export Derived Dynamic Plugin Package](export-derived-package.md).

There are three possible packaging formats for dynamic plugins:

- OCI image
- `tgz` archive
- JavaScript package

**The OCI image is the recommended format.**

The derived dynamic plugin JavaScript packages should **not** be pushed to the public npm registry. They should only be published to a private npm registry.

## Creating OCI Image

**Prerequisites:**

- `podman` or `docker` installed on your system.
- An exported derived dynamic plugin package (see: [Export Derived Dynamic Plugin Package](export-derived-package.md)).

To package the plugin into an OCI image, use the `plugin package` command from `@red-hat-developer-hub/cli` in the plugin’s source code root directory (not in the `dist-dynamic` directory).

The command will output the correct path definition for the plugin, which can be used in the `dynamic-plugin-config.yaml` file.

```bash
npx @red-hat-developer-hub/cli@latest plugin package --tag quay.io/example/image:v0.0.1
```

The `--tag` argument is required when using this packaging method. It specifies the image name and tag. The image won't be pushed to the registry automatically; use the `podman push` or `docker push` command to push the image to the registry.

> **Note:** If `podman` is **not** installed on your system, you must explicitly specify the container tool using the `--container-tool` option.
>
> **Available values:**
> - `"docker"`
> - `"podman"` (default)
> - `"buildah"`
>
> Example using Docker:
>
> ```bash
> npx @red-hat-developer-hub/cli@latest plugin package --container-tool docker --tag quay.io/example/image:v0.0.1
> ```

## Creating a `tgz` Archive

**Prerequisites:**

- An exported derived dynamic plugin package (see: [Export Derived Dynamic Plugin Package](export-derived-package.md)).

To package the plugin into a `tgz` archive, run the `npm pack` command in the `dist-dynamic` directory. This will create a `tgz` archive in the current directory that can be used to install the plugin.

```bash
cd dist-dynamic
npm pack
```

To load the plugin from a `tgz` archive, specify the integrity hash of the archive. You can obtain the hash from the output of the `npm pack` command by using the `--json` flag.

```bash
cd dist-dynamic
npm pack --json | head -n 10
# If you have jq installed, use this command to get the integrity hash directly:
# npm pack --json | jq -r '.[0].integrity'
```

To load the plugin from a `tgz` archive, host the archive on a web server accessible by your RHDH instance and specify the URL in the `dynamic-plugin-config.yaml` file.

If using OpenShift, you can leverage httpd builder to serve these dynamic plugin packages:

```bash
# Pack derived dynamic plugins into `tgz` archives.
# Repeat this step for multiple plugins (place them in the same folder).
npm pack --pack-destination ~/test/dynamic-plugins-root/
# Ensure you're using the same OpenShift project as the RHDH instance.
oc project rhdh
# Create a new build for the httpd image that will serve the `tgz` files with dynamic plugins.
oc new-build httpd --name=plugin-registry --binary
oc start-build plugin-registry --from-dir=dynamic-plugins-root --wait
oc new-app --image-stream=plugin-registry

## Configure your RHDH to use the dynamic plugins from the plugin-registry.
# Edit the `dynamic-plugin-config.yaml` file:
# plugins:
#   - package: http://plugin-registry:8080/backstage-plugin-myplugin-1.9.6.tgz
#   - package: http://plugin-registry:8080/backstage-plugin-myotherplugin-1.10.0.tgz
#
# If you add a new dynamic plugin archive in the ~/test/dynamic-plugins-root folder, and run the OpenShift build again:
# oc start-build plugin-registry --from-dir=dynamic-plugins-root --wait
```

## Creating JavaScript package

**Prerequisites:**

- An exported derived dynamic plugin package (see: [Export Derived Dynamic Plugin Package](export-derived-package.md)).

> [!WARNING]
> Using your own internal npm registry to distribute derived dynamic plugin package is recommended.
> Avoid using the public npm registry (npmjs.com).
> A dynamic plugin is a runtime artifact, and that it is not the best usage of public npm registry to deliver runtime artifacts.
> In container-based environment such as OpenShift or Kubernetes [Creating OCI Image](#creating-oci-image) is the recommended way to distribute dynamic plugins.

```bash
cd dist-dynamic
npm publish --registry <npm_registry_url>
```

Alternatively, add the following to your `package.json` before running `npx @red-hat-developer-hub/cli@latest plugin export`:

```json
{
  "publishConfig": {
    "registry": "<npm_registry_url>"
  }
}
```

If you modify the `publishConfig` after running `export-dynamic-plugin`, run it again to ensure the `dist-dynamic` directory contains a `package.json` with the correct `publishConfig`.
