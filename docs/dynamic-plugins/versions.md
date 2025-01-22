# Version Compatibility Matrix

## RHDH 1.4 (pre-release, versions can change for final release)

<!-- source
https://github.com/redhat-developer/rhdh/blob/main/backstage.json
-->

Based on [Backstage 1.31.3](https://backstage.io/docs/releases/v1.31.0)

To bootstrap Backstage app that is compatible with RHDH 1.4, you can use:

```bash
npx @backstage/create-app@0.5.17
```

### Frontend packages

| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model`     | `1.7.0`     |
| `@backstage/config`            | `1.2.0`     |
| `@backstage/core-app-api`      | `1.15.0`    |
| `@backstage/core-components`   | `0.15.0`    |
| `@backstage/core-plugin-api`   | `1.9.4`     |
| `@backstage/integration-react` | `1.1.32`    |

If you want to check versions of other packages, you can check the [`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/app/package.json) in the [`app`](https://github.com/redhat-developer/rhdh/tree/main/packages/app) package in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).

### Backend packages

| **Package**                                  | **Version** |
| -------------------------------------------- | ----------- |
| `@backstage/backend-app-api`                 | `1.0.0`     |
| `@backstage/backend-defaults`                | `0.5.0`     |
| `@backstage/backend-dynamic-feature-service` | `0.4.1`     |
| `@backstage/backend-plugin-api`              | `1.0.0`     |
| `@backstage/catalog-model`                   | `1.7.0`     |
| `@backstage/cli-node`                        | `0.2.8`     |
| `@backstage/config`                          | `1.2.0`     |
| `@backstage/config-loader`                   | `1.9.1`     |

If you want to check versions of other packages, you can check the [`package.json`](https://github.com/redhat-developer/rhdh/blob/main/packages/backend/package.json) in the [`backend`](https://github.com/redhat-developer/rhdh/tree/main/packages/backend) package in the `main` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/main).

## RHDH 1.3

<!-- source
https://github.com/redhat-developer/rhdh/blob/release-1.3/backstage.json
-->

Based on [Backstage 1.29.2](https://backstage.io/docs/releases/v1.29.0)

To bootstrap Backstage app that is compatible with RHDH 1.3, you can use:

```bash
npx @backstage/create-app@0.5.17
```

### Frontend packages

| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model`     | `1.5.0`     |
| `@backstage/config`            | `1.2.0`     |
| `@backstage/core-app-api`      | `1.14.1`    |
| `@backstage/core-components`   | `0.14.9`    |
| `@backstage/core-plugin-api`   | `1.9.3`     |
| `@backstage/integration-react` | `1.1.29`    |

If you want to check versions of other packages, you can check the [`package.json`](https://github.com/redhat-developer/rhdh/blob/release-1.3/packages/app/package.json) in the [`app`](https://github.com/redhat-developer/rhdh/tree/release-1.3/packages/app) package in the `release-1.3` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-1.3).

### Backend packages

| **Package**                                  | **Version** |
| -------------------------------------------- | ----------- |
| `@backstage/backend-app-api`                 | `0.8.0`     |
| `@backstage/backend-common`                  | `0.23.3`    |
| `@backstage/backend-defaults`                | `0.4.1`     |
| `@backstage/backend-dynamic-feature-service` | `0.2.15`    |
| `@backstage/backend-plugin-api`              | `0.7.0`     |
| `@backstage/catalog-model`                   | `1.5.0`     |
| `@backstage/cli-node`                        | `0.2.7`     |
| `@backstage/config`                          | `1.2.0`     |
| `@backstage/config-loader`                   | `1.8.1`     |

If you want to check versions of other packages, you can check the [`package.json`](https://github.com/redhat-developer/rhdh/blob/release-1.3/packages/backend/package.json) in the [`backend`](https://github.com/redhat-developer/rhdh/tree/release-1.3/packages/backend) package in the `release-1.3` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/release-1.3).

## RHDH 1.2

Based on Backstage 1.26.5
@backstage/create-app 0.5.14

<!-- source
https://github.com/redhat-developer/rhdh/blob/1.2.x/backstage.json
-->

Based on [Backstage 1.26.5](https://backstage.io/docs/releases/v1.26.0)

To bootstrap Backstage app that is compatible with RHDH 1.2, you can use:

```bash
npx @backstage/create-app@0.5.14
```

### Frontend packages

| **Package**                    | **Version** |
| ------------------------------ | ----------- |
| `@backstage/catalog-model`     | `1.4.5`     |
| `@backstage/config`            | `1.2.0`     |
| `@backstage/core-app-api`      | `1.12.4`    |
| `@backstage/core-components`   | `0.14.6`    |
| `@backstage/core-plugin-api`   | `1.9.2`     |
| `@backstage/integration-react` | `1.1.26`    |

If you want to check versions of other packages, you can check the [`package.json`](https://github.com/redhat-developer/rhdh/blob/1.2.x/packages/app/package.json) in the [`app`](https://github.com/redhat-developer/rhdh/tree/1.2.x/packages/app) package in the `1.2.x` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/1.2.x).

### Backend packages

| **Package**                                  | **Version** |
| -------------------------------------------- | ----------- |
| `@backstage/backend-app-api`                 | `0.7.2`     |
| `@backstage/backend-common`                  | `0.21.7`    |
| `@backstage/backend-defaults`                | `0.2.17`    |
| `@backstage/backend-dynamic-feature-service` | `0.2.9`     |
| `@backstage/backend-plugin-api`              | `0.6.17`    |
| `@backstage/catalog-model`                   | `1.4.5`     |
| `@backstage/cli-node`                        | `0.2.5`     |
| `@backstage/config`                          | `1.2.0`     |
| `@backstage/config-loader`                   | `1.8.0`     |

If you want to check versions of other packages, you can check the [`package.json`](https://github.com/redhat-developer/rhdh/blob/1.2.x/packages/backend/package.json) in the [`backend`](https://github.com/redhat-developer/rhdh/tree/1.2.x/packages/backend) package in the `1.2.x` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/1.2.x).
