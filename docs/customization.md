# Customizing the look of your showcase instance

To customize the look of your showcase instance, you can edit the `app-config.yaml` file in the root of this repository. The customizations used to configure the app are loaded by the backstage app at startup, with certain values being queried by the app at runtime.

Plugins can use field `developerHub.flavor` of the `app-config.yaml` to identify which Backstage flavor they are running on (e.g `backstage`, `rhdh` or `rhtap`).

## Changing the Sidebar Logo

The sidebar uses two logos - one for the expanded sidebar and one for the collapsed sidebar.

- To customize the logo for the expanded sidebar, provide a Base64 encoded image of your logo in the `app.branding.fullLogo` field of the `app-config.yaml`.
- To change the width of logo, provide your required size of logo in the `app.branding.fullLogoWidth` field of `app-config.yaml`
- Similarly, to customize the logo for the collapsed sidebar, provide a Base64 encoded image of your logo in the `app.branding.iconLogo` field of the `app-config.yaml`:

```yaml title="app-config.yaml"
app:
  branding:
    fullLogo: ${BASE64_EMBEDDED_FULL_LOGO} # SVG Example: data:image/svg+xml;base64,PD94...
    fullLogoWidth: ${FULL_LOGO_WIDTH} # The following units are supported: <number>, px, em, rem, <percentage>
    iconLogo: ${BASE64_EMBEDDED_ICON_LOGO} # PNG Example: data:image/png;base64,iVBO...
```

![Default Icon Logo when side bar is collapsed](images/default-collapsed-icon.png)
![Default Full Logo when side bar is expanded](images/default-expanded-logo.png)

## Customizing the Sidebar Menu Items

Order and parent-children relationship of sidebar main menu items can be customized using the `dynamicPlugins.frontend.default.main-menu-items.menuItems` field in the `app-config.yaml`. To ensure the menu item is recognized as a main menu item, the key must be prefixed with `default.`.

```yaml title="app-config.yaml"
dynamicPlugins:
  frontend:
    default.main-menu-items: # key for configuring static main menu items
      default.<menu_group_parent_item_name>: # must be configured if it is specified as the parent of any menu items. `default.` prefix is required for a main menu item key
        icon: my_menu_group_icon # required for parent menu items, defines the icon for the menu group
        title: my_menu_group_title # required for parent menu items, defines the icon for the menu group
        priority: 100 # optional, specifies the order of the parent menu item in the sidebar
      default.<menu_item_name>: # key of the menu item configuration. `default.` prefix is required for a main menu item key
        parent: my_menu_group # optional, specifies the parent menu item for this item
        priority: 10 # optional, specifies the order of this menu item within its menu level
        icon: my_menu_group_icon # optional, defines the icon for the menu group
        title: my_menu_group_title # required for new menu items, for default menu items if not provided will pick the default title and if provided as empty string '', then this will be hidden
        to: </path/to/the/target/page> # optional, specifies the target navigation path
```

`default.<menu_item_name>`: The `default.` prefix is mandatory to ensure that the menu item is recognized as a main menu item. It should be used for both individual menu items and parent menu group configurations.

See [Menu items](dynamic-plugins/frontend-plugin-wiring.md#menu-items) from dynamic-plugins documentation for more details.

See [DefaultMainMenuItems](https://github.com/redhat-developer/rhdh/blob/main/packages/app/src/consts.ts#L1) for a list of main menu items, including their default priorities.

## Changing the favicon and tab title

Currently, the favicon customization utilizes the same Base64 encoded image as the icon logo provided via `app.branding.iconLogo` in the `app-config.yaml`
Currently the favicon is only loaded once at startup, so if any changes need to be made to the favicon, the app will need to be restarted.

```yaml title="app-config.yaml"
app:
  branding:
    iconLogo: ${BASE64_EMBEDDED_ICON_LOGO}
```

To customize the tab title, provide a string value to the `app.title` field in the `app-config.yaml`:

```yaml title="app-config.yaml"
app:
  title: my-custom-title
```

You should then see the title of the tab in the form of `<page title> | my-custom-title`

![Custom Title and Favicon](images/custom-title-and-favicon.png)

## Customizing the your showcase colors

For all the color related customizations, the supported color formats are:

- Hexadecimal (`#nnn` or `#nnnnnn`)
- [hsl()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl) and [hsla()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl#legacy_syntax_hsla)
- [rgb()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/rgb) and [rgba()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/rgb#**legacy_syntax_rgba)
- [color()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color)

Currently, color customization between light mode and dark mode are separate and can be configured in their corresponding `app.branding.theme.[light or dark]` fields in the `app-config.yaml` file.

### Customizing the primary colors

To customize the color of links and buttons, provide your color in a [supported format](#customizing-the-your-showcase-colors) to the `app.branding.theme.[light or dark].primaryColor` field of the `app-config.yaml` file:

```yaml title="app-config.yaml"
app:
  branding:
    theme:
      light:
        primaryColor: '#38be8b'
      dark:
        primaryColor: '#ab75cf'
```

![Example Light Mode Primary Color](images/example-light-mode-primary-color.png)
![Example Dark Mode Primary Color](images/example-dark-mode-primary-color.png)

### Customizing the header banner colors

The header banner is a comprised of a pattern of two colors. It is possible to provide different customizations depending on whether the app is in light mode or dark mode. To customize the header banner colors, provide your colors in a [supported format](#customizing-the-your-showcase-colors) to the `app.branding.theme.[light or dark].headerColor[1 or 2]` fields of the `app-config.yaml` file.

Example configurations:

```yaml title="app-config.yaml"
app:
  branding:
    theme:
      light:
        headerColor1: 'hsl(204 100% 71%)'
        headerColor2: 'color(a98-rgb 1 0 0)'
      dark:
        headerColor1: '#0000d0'
        headerColor2: 'rgb(255 246 140)'
```

![Example Light Mode Banner](images/example-light-mode-banner.png)
![Example Dark Mode Banner](images/example-dark-mode-banner.png)

### Customizing navigation indicator color

To customize the navigation indicator color of the sidebar for both light mode or dark mode. Provide the color in a [supported format](#customizing-the-your-showcase-colors) in the `app.branding.theme.[light or dark].navigationIndicatorColor` field of the `app-config.yaml` file:

```yaml title="app-config.yaml"
app:
  branding:
    theme:
      light:
        navigationIndicatorColor: '#be0000'
      dark:
        navigationIndicatorColor: '#f4eea9'
```

![Example Light Mode Sidebar Indicator](images/example-sidebar-indicator-light.png)
![Example Dark Mode Sidebar Indicator](images/example-sidebar-indicator-dark.png)

## Customizing Support button content

To customize the Support button content, provide your support team links and icons to the `app.support` field of the `app-config.yaml` file.

Example configurations:

```
app:
  support:
    url: https://github.com/redhat-developer/rhdh/issues # Used as contact support link on common ErrorPage
    items:                                                      # Used by common SupportButton component
      - title: Issues
        icon: github
        links:
          - url: https://github.com/redhat-developer/rhdh/issues
            title: GitHub Issues
      - title: Join the community
        icon: chat
        links:
          - url: https://janus-idp.io/community/
            title: Janus Community
```

![Example Support Configured](images/example-support-button.png)

If support is not configured, it would look as below.

![Example Support Not Configured](images/support-not-configured.png)
