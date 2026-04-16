
## RHDH 1.8 

<!-- source
https://github.com/redhat-developer/rhdh/blob/release-1.8/backstage.json
-->

Based on [Backstage 1.42.5](https://backstage.io/docs/releases/v1.42.0)

To bootstrap Backstage app that is compatible with RHDH 1.4, you can use:

```bash
npx @backstage/create-app@0.7.3
```

### Frontend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model` | `1.7.5` |
| `@backstage/config` | `1.3.3` |
| `@backstage/core-app-api` | `1.18.0` |
| `@backstage/core-components` | `0.17.5` |
| `@backstage/core-plugin-api` | `1.10.9` |
| `@backstage/integration-react` | `1.2.9` |



If you want to check versions of other packages, you can check the 
[`package.json`](https://github.com/redhat-developer/rhdh/blob/release-1.8/packages/app/package.json) in the
[`app`](https://github.com/redhat-developer/rhdh/tree/release-1.8/packages/app) package 
in the `release-1.8` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-1.8).

### Backend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/backend-app-api` | `1.2.6` |
| `@backstage/backend-defaults` | `0.12.0` |
| `@backstage/backend-dynamic-feature-service` | `0.7.3` |
| `@backstage/backend-plugin-api` | `1.4.2` |
| `@backstage/catalog-model` | `1.7.5` |
| `@backstage/cli-node` | `0.2.14` |
| `@backstage/config` | `1.3.3` |
| `@backstage/config-loader` | `1.10.2` |



If you want to check versions of other packages, you can check the
[`package.json`](https://github.com/redhat-developer/rhdh/blob/release-1.8/packages/backend/package.json) in the
[`backend`](https://github.com/redhat-developer/rhdh/tree/release-1.8/packages/backend) package
in the `release-1.8` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-1.8).
