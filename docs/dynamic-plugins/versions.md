
## RHDH 1.9 

<!-- source
https://github.com/redhat-developer/rhdh/blob/release-1.9/backstage.json
-->

Based on [Backstage 1.45.3](https://backstage.io/docs/releases/v1.45.0)

To bootstrap Backstage app that is compatible with RHDH 1.4, you can use:

```bash
npx @backstage/create-app@0.7.6
```

### Frontend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model` | `1.7.6` |
| `@backstage/config` | `1.3.6` |
| `@backstage/core-app-api` | `1.19.2` |
| `@backstage/core-components` | `0.18.3` |
| `@backstage/core-plugin-api` | `1.12.0` |
| `@backstage/integration-react` | `1.2.12` |



If you want to check versions of other packages, you can check the 
[`package.json`](https://github.com/redhat-developer/rhdh/blob/release-1.9/packages/app/package.json) in the
[`app`](https://github.com/redhat-developer/rhdh/tree/release-1.9/packages/app) package 
in the `release-1.9` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-1.9).

### Backend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/backend-app-api` | `1.3.0` |
| `@backstage/backend-defaults` | `0.13.1` |
| `@backstage/backend-dynamic-feature-service` | `0.7.6` |
| `@backstage/backend-plugin-api` | `1.5.0` |
| `@backstage/catalog-model` | `1.7.6` |
| `@backstage/cli-node` | `0.2.15` |
| `@backstage/config` | `1.3.6` |
| `@backstage/config-loader` | `1.10.6` |



If you want to check versions of other packages, you can check the
[`package.json`](https://github.com/redhat-developer/rhdh/blob/release-1.9/packages/backend/package.json) in the
[`backend`](https://github.com/redhat-developer/rhdh/tree/release-1.9/packages/backend) package
in the `release-1.9` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-1.9).
