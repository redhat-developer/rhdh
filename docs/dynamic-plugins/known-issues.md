# Known Issues

## MUI Version 5 releated issues

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