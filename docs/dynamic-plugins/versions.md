
## RHDH next (pre-release, versions can change for final release)

<!-- source
https://github.com/redhat-developer/rhdh/blob/main/backstage.json
-->

Based on [Backstage 1.57.1](https://backstage.io/docs/releases/v1.57.0)

To bootstrap Backstage app that is compatible with RHDH next, you can use:

```bash
npx @backstage/create-app@0.9.4
```

### Frontend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model` | `1.10.3` |
| `@backstage/config` | `1.3.11` |
| `@backstage/core-app-api` | `1.20.7` |
| `@backstage/core-components` | `0.18.16` |
| `@backstage/core-plugin-api` | `1.13.0` |
| `@backstage/integration-react` | `1.3.0` |



If you want to check versions of other packages, you can check the 
[`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/app/package.json) in the
[`app`](https://github.com/redhat-developer/rhdh/tree/main/packages/app) package 
in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).

### Backend packages


| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/backend-app-api` | `1.9.0` |
| `@backstage/backend-defaults` | `0.19.0` |
| `@backstage/backend-dynamic-feature-service` | `0.8.9` |
| `@backstage/backend-plugin-api` | `1.12.0` |
| `@backstage/catalog-model` | `1.10.3` |
| `@backstage/cli-node` | `0.3.6` |
| `@backstage/config` | `1.3.11` |
| `@backstage/config-loader` | `undefined` |



If you want to check versions of other packages, you can check the
[`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/backend/package.json) in the
[`backend`](https://github.com/redhat-developer/rhdh/tree/main/packages/backend) package
in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).
