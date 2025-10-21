# Creating & Editing Extension Catalog Plugins

Spreadsheet for tracking the work is here: https://docs.google.com/spreadsheets/d/1K_LqKYma9nRM5teKD-uCnbB3qKC8Hk2E5jvcpMSfjTs/edit?gid=771893283#gid=771893283

## Working with Plugin Folders & Files

Below are some practical instructions that might help you in the process of creating and updating plugins and packages for use in the RHDH Extensions catalog plugin.

## `packages/`

Packages describe the frontend and backend packages that form part of a plugin. The packages folder contains the individual `package.yaml` files where you can set various details about your plugin packages. For an example, see the 3scale package details in `packages/backstage-community-plugin-3scale-backend.yaml`

```yaml
apiVersion: extensions.backstage.io/v1alpha1
kind: Package # Important to set the kind
metadata:
  name: backstage-community-plugin-3scale-backend # This name is important - it provides a linkage from the plugin record
  namespace: rhdh # This plugin package is built by us and provided in RHDH
  title: "@backstage-community/plugin-3scale-backend"
  links: # Links to useful sources etc.
    - url: https://red.ht/rhdh
      title: Homepage
    - url: https://issues.redhat.com/browse/RHIDP
      title: Bugs
    - title: Source Code
      url: https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers/backstage-community-plugin-3scale-backend-dynamic
  annotations: # Activates backstage features
    backstage.io/source-location: url
      https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers/backstage-community-plugin-3scale-backend-dynamic
  tags: []
spec: # Custom information processed by the Extensions plugin
  packageName: "@backstage-community/plugin-3scale-backend"
  dynamicArtifact: ./dynamic-plugins/dist/backstage-community-plugin-3scale-backend-dynamic
  version: 3.2.0 # The plugin version
  backstage:
    role: backend-plugin
    supportedVersions: 1.35.1 # The supported version of Backstage
  author: Red Hat # The Author of the package
  support: tech-preview # The release status of the package
  lifecycle: active # The backstage lifecycle stage
  partOf:
    - backstage-community-plugin-3scale-backend # Links this package to others in the same group
  appConfigExamples: # Information on how to configure the plugin (not used yet)
    - title: Default configuration
      content:
        catalog:
          providers:
            threeScaleApiEntity:
              default:
                baseUrl: ${THREESCALE_BASE_URL}
                accessToken: ${THREESCALE_ACCESS_TOKEN}
```


## `packages/all.yaml`

You **must** add your package yaml file to the list in the `packages/all.yaml` file to get it picked up by RHDH and loaded into the catalog. To check if it's loading, check the catalog.

## `plugins/`

The files in the `plugins` folder describe the plugins themselves. The plugins folder contains the individual `plugin.yaml` files where you can set various details about your plugin - many of which appear on screen in RHDH in the "Extensions" catalog tab. For an example, see the 3scale package details in `plugins/3scale.yaml`.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/redhat-developer/rhdh-plugins/refs/heads/main/workspaces/marketplace/json-schema/plugins.json
apiVersion: extensions.backstage.io/v1alpha1
kind: Plugin # Important to set the kind
metadata:
  name: 3scale # The catalog entity name
  namespace: rhdh # This plugin is built by us and provided in RHDH
  title: 3scale
  annotations:
    extensions.backstage.io/pre-installed: 'true' # this means the plugin yaml is preinstalled, not the plugin itself, all other plugins are marked as 'custom'
    extensions.backstage.io/verified-by: Red Hat # Set the verified status
    # extensions.backstage.io/certified-by: Red Hat # Set the certified status
  links: # Useful links for the plugin card when expanded
    - url: https://red.ht/rhdh
      title: Homepage
    - url: https://issues.redhat.com/browse/RHIDP
      title: Bugs
    - title: Source Code
      url: https://github.com/redhat-developer/rhdh/tree/main/dynamic-plugins/wrappers/backstage-community-plugin-3scale-backend-dynamic
  tags:
    - apis
  # The description below is used in the Extension plugin's "Tile" view as the plugin description. Keep it to a few lines (short description)
  description: |
    3scale provides a comprehensive API management solution, enabling organizations to secure, manage, and monetize APIs.
    Key features include access control, usage analytics, and policy enforcement.
    The 3scale plugin synchronizes your 3scale content into the software catalog.
spec: # Custom information processed by the Extensions plugin
  author: Red Hat # The Author of the plugin
  support: tech-preview # The Red Hat release status of the plugin
  lifecycle: active # The backstage lifecycle stage of the plugin
  publisher: Red Hat # Used to collect together plugins by the same author and display an extra line on the tile e/g/ "By Red Hat"

  # The long description below is used in the Extension plugin's "Expanded Info" view as the plugin's long description. You should include information here about the the purpose of the plugin and how it integrates with RHDH. The description here uses Markdown fomat, but DON'T include images - they won't load if you do.
  description: |
    The 3scale Backstage plugin...
    (add further text here to really describe to the user what your plugin is for and how it integrates with RHDH's frontend/backend).

    * Use bullets if you need to

    ## Adding The Plugin To Red Hat Developer Hub

    See the Red Hat Developer Hub documentation in the links below for details of how to install, activate, and configure plugins.

  categories: # Categories show up in the tile view (limited to one)
    - API Management
  highlights: # Highlights show up on the extended information page
    - OpenShift support
    - Access Control & Security (Managed within 3scale)
    - Rate Limiting & Quotas (Managed within 3scale)
    - API Monetization Tools (Managed within 3scale)
    - Policy Enforcement (Managed within 3scale)

  # Icons need to be base64 encoded SVG files, and can be inserted here (most are done already).
  icon: data:image/svg+xml;base64,
    PHN2ZyB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHZpZXdCb3g9IjAgMCA5NiA5NiIgZmlsbD0ibm9u
    etc...

  # By linking to packages you enable the "Versions" section in the expanded information view
  packages: # Links to the pacjage name you set in the packages for this plugin
    - backstage-community-plugin-3scale-backend

  # unused at the moment, but could allow for an image carousel later
  assets:
    - type: icon
      filename: img/3scale.svg
      originUri: https://github.com/backstage/backstage/blob/master/microsite/static/img/3scale.svg
    - type: image
      filename: img/backstage_dynatrace_plugin.png
      originUri: https://github.com/Dynatrace/backstage-plugin/blob/a307710edfb23a196c30790b9afceb9fb9af27df/docs/images/backstage_dynatrace_plugin.png

  # Unused at the moment
  history:
    added: '2023-05-15'
```

## `plugins/all.yaml`

You **must** add your plugin yaml file to the list in the `plugins/all.yaml` file to get it picked up by RHDH and loaded into the catalog. To check if it's loading, check the catalog.


# Using RHDH-local

You need to reconfigure a few bits for the rhdh-1.5 image build, but when you do your local edits will show up within 15 secs...

In `app-config.yaml` do this:

```yaml:app-config.yaml

catalog:
  # Speed up the metadata refresh interval (when testing)
  processingInterval: { seconds: 15 }

  locations:
    # Extensions Plugin needs this target to pull in the information about Plugins
    - type: file
      target: /marketplace/catalog-entities/plugins/all.yaml
      rules:
        - allow: [Location, Plugin]
    - type: file
      target: /marketplace/catalog-entities/packages/all.yaml
      rules:
        - allow: [Location, Package]

```

In `compose.yaml` do this:

```yaml:compose.yaml
services:
  rhdh:
    volumes:
      # Add an Extensions overwrite
      - type: bind
        source: <your rhdh cloned repo>/catalog-entities/marketplace/plugins/
        target: /marketplace/catalog-entities/plugins
      - type: bind
        source: <your rhdh cloned repo>/catalog-entities/marketplace/packages/
        target: /marketplace/catalog-entities/packages
```

## Troubleshooting

Some issues you may encounter and how to get around them.

### Duplicate Entries

Because Backstage doesn't remove catalog entries when the source changes, sometimes you will end up with duplicates. For example
if you rename a plugin file, you may end up with the old catalog entry sticking around. To fix this you need to purge the
backstage database. If running the in-memory database, this is easily acheived by restarting the container:

```bash
docker compose restart rhdh # or podman-compose restart rhdh
```

### Catalog stops loading or refreshing

Sometimes you might make a mistake with a plugin yaml file. If that happens you can use commenting of lines in the `plugins/all.yaml`
to stop certain plugins from being loaded into the catalog. You can allso search for `all.yaml` in the RHDH logs to see if you can
find a clue as to what caused the catalog entries to stop loading. For example:

```bash
rhdh  | {"entity":"location:rhdh/plugins","level":"\u001b[33mwarn\u001b[39m","location":"file:/marketplace/catalog-entities/plugins/all.yaml","message":"YAML error at file:/marketplace/catalog-entities/plugins/keycloak-catalog-integration.yaml, YAMLParseError: Map keys must be unique at line 99, column 3:\n\n  #   level: tech-preview\n  lifecycle: production\n  ^\n","plugin":"catalog","service":"backstage","timestamp":"2025-03-11 15:56:57"}
```

### Is my plugin here or missing?

You can trace packages back to plugin entries using the VS Code "Find In Folder..." feature. For example:

1. Given the plugin ID `@backstage-community/plugin-quay` (replace with the plugin ID you need)
1. Do a "Find in Folder..." search for the `package/` file that contains this entry.
1. The `/packages/backstage-community-plugin-quay.yaml` contains this entry.
1. Open this file and look for the `metadata.name` (`backstage-community-plugin-quay`).
1. Now do a search in the plugins folder for the text `backstage-community-plugin-quay`.
1. The `plugins/backstage-community-plugin-quay.yaml` contains this text.
1. You can open the file and edit the text.

If you do not find a plugin.yaml associated with this plugin ID then it is probably missing and you need to create one. The
file `1boilerplate.yaml` has a good starting point for creating these files.


## Important Notes:

* Plugins are manually created
* Packages are generated with the command below

```bash
# in rhdh root
npx --yes @red-hat-developer-hub/marketplace-cli generate --namespace rhdh -p dynamic-plugins.default.yaml -o catalog-entities/marketplace/packages
```
