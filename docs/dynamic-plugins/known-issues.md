# Known Issues

## MUI Version 5 releated issues

### Styles are missing

When your plugin uses MUI v5 and is loaded as a dynamic plugin, it will miss some of the default CSS declations from MUI and Backstage/RHDH.

**Workaround:**

Add the following source code to your `<plugin>/src/index.ts` before your plugin is exported:

```tsx
import { unstable_ClassNameGenerator as ClassNameGenerator } from '@mui/material/className';

ClassNameGenerator.configure(componentName => {
  return componentName.startsWith('v5-')
    ? componentName
    : `v5-${componentName}`;
});

export * from './plugin';
```

**Alternatives:**

* Use Backstage Core Components or Material UI v4 components from `@material-ui/core/*`.

**Related issues:**

* [RHIDP-5170 - Dynamic plugin loaded plugins that uses MUI v5 looks different then static loaded plugins](https://issues.redhat.com/browse/RHIDP-5170)
* [RHIDP-5847 - Narrow the accepted versions in the scalprum webpack federated module configuration](https://issues.redhat.com/browse/RHIDP-5847)

### Grid cards/component misses the default spacing from Backstage

When your plugin is using the Grid component from `@mui/material/Grid` the default spacing from the Backstage/RHDH theme is missing.

**Workaround:**

Manually apply the prop `spacing={2}` to the `Grid container`s:

```tsx
<Grid container spacing={2} ...>
  <Grid item ...>
    ...
  </Grid>
  <Grid item ...>
    ...
  </Grid>
</Grid>
```

**Alternatives:**

* Use Material UI v4 Grid from `@material-ui/core/Grid`.

**Related issues:**

* [RHIDP-5170 - Dynamic plugin loaded plugins that uses MUI v5 looks different then static loaded plugins](https://issues.redhat.com/browse/RHIDP-5170)