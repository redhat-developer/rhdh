
## RHDH 2.1 

<!-- source
https://github.com/redhat-developer/rhdh/blob/release-2.1/backstage.json
-->

Based on [Backstage 1.54.9](https://backstage.io/docs/releases/v1.54.0)

To bootstrap Backstage app that is compatible with RHDH 2.1, you can use:

```bash
npx @backstage/create-app@0.9.1
```

### Frontend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model` | `1.10.0` |
| `@backstage/config` | `1.3.8` |
| `@backstage/core-app-api` | `1.20.4` |
| `@backstage/core-components` | `0.18.13` |
| `@backstage/core-plugin-api` | `1.12.9` |
| `@backstage/integration-react` | `1.2.21` |



If you want to check versions of other packages, you can check the 
[`package.json`](https://github.com/redhat-developer/rhdh/blob/release-2.1/packages/app/package.json) in the
[`app`](https://github.com/redhat-developer/rhdh/tree/release-2.1/packages/app) package 
in the `release-2.1` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-2.1).

### Backend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/backend-app-api` | `1.7.3` |
| `@backstage/backend-defaults` | `0.17.8` |
| `@backstage/backend-dynamic-feature-service` | `0.8.6` |
| `@backstage/backend-plugin-api` | `1.10.0` |
| `@backstage/catalog-model` | `1.10.0` |
| `@backstage/cli-node` | `0.3.4` |
| `@backstage/config` | `1.3.8` |
| `@backstage/config-loader` | `undefined` |



If you want to check versions of other packages, you can check the
[`package.json`](https://github.com/redhat-developer/rhdh/blob/release-2.1/packages/backend/package.json) in the
[`backend`](https://github.com/redhat-developer/rhdh/tree/release-2.1/packages/backend) package
in the `release-2.1` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-2.1).
