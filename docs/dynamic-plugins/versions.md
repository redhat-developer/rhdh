
## RHDH next (pre-release, versions can change for final release)

<!-- source
https://github.com/redhat-developer/rhdh/blob/main/backstage.json
-->

Based on [Backstage 1.36.1](https://backstage.io/docs/releases/v1.36.0)

To bootstrap Backstage app that is compatible with RHDH 1.4, you can use:

```bash
npx @backstage/create-app@0.5.25
```

### Frontend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model` | `1.7.3` |
| `@backstage/config` | `1.3.2` |
| `@backstage/core-app-api` | `1.15.5` |
| `@backstage/core-components` | `0.16.4` |
| `@backstage/core-plugin-api` | `1.10.4` |
| `@backstage/integration-react` | `1.2.4` |



If you want to check versions of other packages, you can check the 
[`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/app/package.json) in the
[`app`](https://github.com/redhat-developer/rhdh/tree/main/packages/app) package 
in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).

### Backend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/backend-app-api` | `1.2.0` |
| `@backstage/backend-defaults` | `0.8.1` |
| `@backstage/backend-dynamic-feature-service` | `0.6.0` |
| `@backstage/backend-plugin-api` | `1.2.0` |
| `@backstage/catalog-model` | `1.7.3` |
| `@backstage/cli-node` | `0.2.13` |
| `@backstage/config` | `1.3.2` |
| `@backstage/config-loader` | `1.9.6` |



If you want to check versions of other packages, you can check the
[`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/backend/package.json) in the
[`backend`](https://github.com/redhat-developer/rhdh/tree/main/packages/backend) package
in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).
