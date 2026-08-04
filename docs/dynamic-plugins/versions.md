
## RHDH next (pre-release, versions can change for final release)

<!-- source
https://github.com/redhat-developer/rhdh/blob/main/backstage.json
-->

Based on [Backstage 1.52.0](https://backstage.io/docs/releases/v1.52.0)

To bootstrap Backstage app that is compatible with RHDH next, you can use:

```bash
npx @backstage/create-app@0.8.4
```

### Frontend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model` | `1.9.0` |
| `@backstage/config` | `1.3.8` |
| `@backstage/core-app-api` | `1.20.2` |
| `@backstage/core-components` | `0.18.11` |
| `@backstage/core-plugin-api` | `1.12.7` |
| `@backstage/integration-react` | `1.2.19` |



If you want to check versions of other packages, you can check the 
[`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/app/package.json) in the
[`app`](https://github.com/redhat-developer/rhdh/tree/main/packages/app) package 
in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).

### Backend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/backend-app-api` | `1.7.1` |
| `@backstage/backend-defaults` | `0.17.3` |
| `@backstage/backend-dynamic-feature-service` | `0.8.3` |
| `@backstage/backend-plugin-api` | `1.9.2` |
| `@backstage/catalog-model` | `1.9.0` |
| `@backstage/cli-node` | `0.3.3` |
| `@backstage/config` | `1.3.8` |
| `@backstage/config-loader` | `undefined` |



If you want to check versions of other packages, you can check the
[`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/backend/package.json) in the
[`backend`](https://github.com/redhat-developer/rhdh/tree/main/packages/backend) package
in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).
