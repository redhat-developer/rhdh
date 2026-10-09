/**
 * Runtime deployment configuration — single source of truth.
 *
 * Generates Helm values and Operator Backstage CR from a shared config,
 * ensuring both install methods stay in sync.
 *
 * Design:
 *   - Shared constants live here (app title, guest auth, dynamic plugins, …).
 *   - Helm values YAML is generated with ONLY the overrides that differ from
 *     the chart defaults.  The chart owns the system volumes, so
 *     extraVolumes/extraVolumeMounts only carry the runtime additions.
 *   - Operator ConfigMaps / Backstage CR are generated programmatically.
 *   - CATALOG_INDEX_IMAGE opt-in override: Helm uses
 *     `catalogIndex.image.*` --set flags; Operator pushes an env var
 *     with `containers: ["install-dynamic-plugins"]`.
 */

import type { V1Container } from "@kubernetes/client-node";
import * as yaml from "yaml";

import {
  buildCloudSqlProxy,
  buildCloudSqlProxyVolume,
  buildCloudSqlEntityServer,
  cloudSqlAppConfig,
  CLOUD_SQL_DB_SECRET,
  type CloudSqlDeploymentConfig,
} from "./cloudsql-config";
import { type ImageRef, buildImageRef, imageRefToString, parseCatalogIndexImage } from "./helper";
import { BACKSTAGE_BACKEND_CONTAINER } from "./kube-client";

// ─── Shared constants ────────────────────────────────────────────────────────

const appTitle = "Red Hat Developer Hub";
const homeExtensions = [
  { "page:home": { config: { path: "/" } } },
  { "api:home/visits": true },
  { "app-root-element:home/visit-listener": true },
];

/**
 * Auth providers are no longer built into the backend, and the catalog index
 * ships the guest provider disabled. Without it the guest session has no user
 * token, so anything that needs one (user identity, TechDocs) returns 401.
 */
const guestAuthProviderPlugin = {
  package:
    "oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-auth-backend-module-guest-provider:bs_1.54.6__0.2.22",
  enabled: true,
};

/** Backstage CRD API version — update when the CRD version bumps. */
export const BACKSTAGE_CR_API_VERSION = "rhdh.redhat.com/v1alpha5";

// ─── Resolved configuration ─────────────────────────────────────────────────

export interface RuntimeDeployConfig {
  releaseName: string;
  namespace: string;
  routerBase: string;
  image: ImageRef;
  internalPostgresqlImage: ImageRef;
  catalogIndex?: ImageRef;
  helm?: { chartUrl: string; chartVersion: string };
  cloudSql?: CloudSqlDeploymentConfig;
  externalPostgres?: { host: string; port: number; user: string; databasePrefix: string };
  revision?: string;
}

export const RUNTIME_DB_SECRET = "runtime-database";

export function externalPostgresAppConfig(
  config: NonNullable<RuntimeDeployConfig["externalPostgres"]>,
) {
  return {
    client: "pg",
    pluginDivisionMode: "database",
    prefix: config.databasePrefix,
    connection: {
      host: "${POSTGRES_HOST}",
      port: "${POSTGRES_PORT}",
      user: "${POSTGRES_USER}",
      password: "${POSTGRES_PASSWORD}",
      ssl: { ca: { $file: "/opt/app-root/src/postgres-crt.pem" }, rejectUnauthorized: true },
    },
  };
}

/** Typed Backstage CR used by runtime-deploy and schema-mode-setup. */
export interface BackstageCR {
  kind: "Backstage";
  apiVersion: string;
  metadata: { name: string; [key: string]: unknown };
  spec: {
    deployment?: { patch?: Record<string, unknown> };
    application?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

/** Shared app-config YAML structure used across runtime tests. */
export interface AppConfigYaml {
  app?: { title?: string; baseUrl?: string; [key: string]: unknown };
  backend?: {
    database?: {
      client?: string;
      pluginDivisionMode?: string;
      ensureSchemaExists?: boolean;
      connection?: Record<string, unknown>;
      [key: string]: unknown;
    };
    auth?: Record<string, unknown>;
    baseUrl?: string;
    cors?: Record<string, unknown>;
    [key: string]: unknown;
  };
  auth?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Build a RuntimeDeployConfig from environment variables.
 */
export function resolveConfig(routerBase: string): RuntimeDeployConfig {
  const releaseName = process.env.RELEASE_NAME ?? "rhdh";
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const imageRegistry = process.env.IMAGE_REGISTRY ?? "quay.io";
  const imageRepo = process.env.IMAGE_REPO ?? "rhdh-community/rhdh";
  const imageTag = process.env.TAG_NAME ?? "next";
  const internalPostgresqlImage = buildImageRef(
    process.env.POSTGRESQL_IMAGE_REGISTRY!,
    process.env.POSTGRESQL_IMAGE_REPO!,
    process.env.POSTGRESQL_IMAGE_TAG!,
  );

  const config: RuntimeDeployConfig = {
    releaseName,
    namespace,
    routerBase,
    image: buildImageRef(imageRegistry, imageRepo, imageTag),
    internalPostgresqlImage,
    revision: process.env.RUNTIME_RUN_ID,
  };

  // CATALOG_INDEX_IMAGE opt-in override
  if (process.env.CATALOG_INDEX_IMAGE !== undefined && process.env.CATALOG_INDEX_IMAGE !== "") {
    config.catalogIndex = parseCatalogIndexImage(process.env.CATALOG_INDEX_IMAGE);
  }

  // Helm-specific
  const chartUrl = process.env.HELM_CHART_URL ?? "oci://quay.io/rhdh/chart";
  const chartVersion = process.env.CHART_VERSION;
  if (chartVersion !== undefined && chartVersion !== "") {
    config.helm = { chartUrl, chartVersion };
  }

  return config;
}

// ─── Helm values generation ──────────────────────────────────────────────────

/**
 * Generate a Helm values YAML string containing ONLY the overrides that
 * differ from the standalone RHDH chart defaults.
 *
 * Values omitted (inherited from chart defaults):
 *   - dynamicPlugins.{includes, plugins}
 *   - nameOverride
 *   - appConfig.{app.baseUrl, backend.baseUrl, cors, externalAccess}
 *   - BACKEND_SECRET and the PostgreSQL credentials (injected by the chart)
 *   - postgresql.enabled
 *
 * The chart owns the system volumes (dynamic-plugins-root, dynamic-plugins,
 * dynamic-plugins-npmrc, dynamic-plugins-registry-auth, npmcacache,
 * extensions-catalog, temp), so only the runtime additions go in
 * extraVolumes/extraVolumeMounts. dynamic-plugins-root is switched to a PVC
 * through dynamicPlugins.volume instead of redefining the volume.
 */
const tpl = (expr: string) => `{{ ${expr} }}`;

export function generateHelmValuesYaml(config?: RuntimeDeployConfig): string {
  // Build the YAML as a plain object, then dump.
  // Helm template expressions are embedded as literal strings — Helm's
  // template engine evaluates them at render time regardless of whether
  // values come from a file or stdin.
  const printfRelease = (suffix: string) => tpl(`printf "%s-${suffix}" .Release.Name`);

  const cloudSql = config?.cloudSql;
  const external = config?.externalPostgres;
  const values = {
    strategy: { type: "Recreate" },
    ...(config?.revision === undefined
      ? {}
      : { podAnnotations: { "rhdh.redhat.com/runtime-run": config.revision } }),
    ...(external
      ? {
          postgresql: { enabled: false },
          externalDatabase: {
            host: external.host,
            port: external.port,
            user: external.user,
            existingSecretRef: { name: RUNTIME_DB_SECRET, key: "POSTGRES_PASSWORD" },
          },
        }
      : {}),
    ...(cloudSql
      ? {
          postgresql: { enabled: false },
          externalDatabase: {
            host: "127.0.0.1",
            port: 5432,
            user: cloudSql.user,
            existingSecretRef: { name: CLOUD_SQL_DB_SECRET, key: "POSTGRES_PASSWORD" },
          },
          preInitContainers: [buildCloudSqlProxy(cloudSql.instanceConnectionName)],
          extraContainers: [buildCloudSqlEntityServer(imageRefToString(config.image))],
          podAnnotations: { "rhdh.redhat.com/cloudsql-revision": cloudSql.revision },
          extraEnv: [
            {
              name: "CLOUDSQL_API_TOKEN",
              valueFrom: {
                secretKeyRef: { name: CLOUD_SQL_DB_SECRET, key: "CLOUDSQL_API_TOKEN" },
              },
            },
          ],
        }
      : {}),
    commonLabels: { "backstage.io/kubernetes-id": "developer-hub" },
    image: { pullPolicy: "Always" },
    // Runtime tests only cover ConfigMap changes and DB connectivity, so the
    // Intelligent Assistant sidecar would only slow down every restart.
    intelligentAssistant: { enabled: false },
    appConfig: {
      app: {
        title: appTitle,
        // The new frontend system ships page:home disabled, so "/" is a 404
        // without it. Same home extensions as the CI dynamic-plugins-config.yaml.
        extensions: homeExtensions,
      },
      ...(cloudSql
        ? {
            backend: cloudSqlAppConfig(cloudSql),
          }
        : {}),
      ...(external ? { backend: { database: externalPostgresAppConfig(external) } } : {}),
      auth: {
        environment: "development",
        providers: {
          guest: { dangerouslyAllowOutsideDevelopment: true },
        },
      },
    },
    dynamicPlugins: {
      // PVC instead of the chart-default ephemeral volume — persists plugins
      // across deployment restarts (config-map and schema-mode tests both
      // restart RHDH). The PVC is created by runtime-deploy.ts.
      volume: {
        type: "pvc",
        pvc: { claimName: printfRelease("dynamic-plugins-root") },
      },
      plugins: [guestAuthProviderPlugin],
    },
    // The chart's default-deny NetworkPolicies only let the backend reach the
    // in-namespace PostgreSQL, so the external DB tests (RDS, Azure) could
    // never connect. Same allowance CI applies to its namespaces
    // (netpol-ci-allow-backend-egress.yaml).
    extraDeploy: [
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "NetworkPolicy",
        metadata: { name: printfRelease("ci-allow-backend-egress") },
        spec: {
          podSelector: {
            matchLabels: {
              "app.kubernetes.io/instance": tpl(".Release.Name"),
              "app.kubernetes.io/component": "backstage",
            },
          },
          policyTypes: ["Egress"],
          egress: [{}],
        },
      },
    ],
    // Runtime addition: postgres certificate for external DB tests
    extraVolumeMounts: [
      {
        name: "postgres-crt",
        mountPath: "/opt/app-root/src/postgres-crt.pem",
        subPath: "postgres-crt.pem",
      },
    ],
    extraVolumes: [
      ...(cloudSql
        ? [
            buildCloudSqlProxyVolume(),
            {
              name: "cloud-sql-entity",
              configMap: { name: "cloud-sql-entity" },
            },
          ]
        : []),
      {
        name: "postgres-crt",
        secret: { secretName: "postgres-crt", optional: true },
      },
    ],
  };

  return yaml.stringify(values, { lineWidth: 0 });
}

/**
 * `--set` flags for one chart image. A digest reference (`repo@sha256:...`)
 * goes to `.digest`, because the chart renders `.tag` as `repo:tag`. A tag
 * reference clears the chart's default digest so the tag wins.
 */
function imageSetArgs(valuesPath: string, image: ImageRef): string[] {
  const isDigest = image.separator === "@";
  return [
    "--set",
    `${valuesPath}.registry=${image.registry}`,
    "--set",
    `${valuesPath}.repository=${image.repository}`,
    "--set",
    `${valuesPath}.tag=${isDigest ? "" : image.tag}`,
    "--set",
    `${valuesPath}.digest=${isDigest ? image.tag : ""}`,
  ];
}

/**
 * Generate the Helm arguments for `helm upgrade -i`.
 *
 * These are values that must be resolved at deploy time (cluster-specific
 * or image-specific), not baked into the values YAML.
 */
export function generateHelmSetArgs(config: RuntimeDeployConfig): string[] {
  const args: string[] = [
    "--set",
    `openshift.clusterRouterBase=${config.routerBase}`,
    ...imageSetArgs("image", config.image),
    ...imageSetArgs("postgresql.image", config.internalPostgresqlImage),
  ];

  // CATALOG_INDEX_IMAGE override — mirrors helm::get_image_params() in
  // .ci/pipelines/lib/helm.sh.  When not set, the chart's built-in
  // catalogIndex default takes effect.
  if (config.catalogIndex) {
    args.push(...imageSetArgs("catalogIndex.image", config.catalogIndex));
  }

  return args;
}

// ─── Operator app-config generation ──────────────────────────────────────────

/**
 * Generate the app-config YAML for the operator-deployed runtime RHDH.
 *
 * The operator path needs an explicit app-config ConfigMap because it
 * doesn't have Helm template helpers for hostname resolution.
 */
export function generateAppConfigYaml(runtimeUrl: string, config?: RuntimeDeployConfig): string {
  const appConfig = {
    app: {
      title: appTitle,
      baseUrl: runtimeUrl,
      extensions: homeExtensions,
    },
    backend: {
      auth: {
        externalAccess: [
          {
            type: "legacy",
            options: {
              subject: "legacy-default-config",
              secret: "secret",
            },
          },
        ],
      },
      baseUrl: runtimeUrl,
      cors: { origin: runtimeUrl },
      ...(config?.cloudSql ? cloudSqlAppConfig(config.cloudSql, "secret") : {}),
      ...(config?.externalPostgres
        ? { database: externalPostgresAppConfig(config.externalPostgres) }
        : {}),
    },
    auth: {
      environment: "development",
      providers: {
        guest: { dangerouslyAllowOutsideDevelopment: true },
      },
    },
  };

  return yaml.stringify(appConfig, { lineWidth: 0 });
}

// ─── Operator dynamic-plugins ConfigMap ──────────────────────────────────────

/**
 * Generate the dynamic-plugins.yaml content for the operator path.
 *
 * All Operator runtime targets use the catalog-index defaults, matching Helm
 * and supplying RHDH's app-auth and homepage frontend modules, with guest auth enabled.
 */
export function generateDynamicPluginsYaml(): string {
  return yaml.stringify(
    {
      // Runtime tests check the actual RHDH sign-in page and homepage, which are
      // dynamic frontend modules supplied by the catalog index, just as in Helm.
      includes: ["dynamic-plugins.default.yaml"],
      plugins: [guestAuthProviderPlugin],
    },
    { lineWidth: 0 },
  );
}

// ─── Operator Backstage CR generation ────────────────────────────────────────

/**
 * Init container that blocks until the local PostgreSQL accepts connections.
 *
 * The operator starts Backstage and its PostgreSQL StatefulSet at the same
 * time. The DB Service is headless, so its name does not resolve until the
 * PostgreSQL pod is ready. When Backstage wins that race, each plugin fails
 * its database setup with ENOTFOUND, the process stays alive, and the
 * readiness probe returns 503 until the pod is deleted. The Helm chart avoids
 * this with a wait-for-db init container doing the same TCP check.
 */
function generateWaitForDbInitContainer(image: string, dbHost: string): V1Container {
  return {
    name: "wait-for-db",
    image,
    command: [
      "bash",
      "-c",
      `until timeout 2 bash -c '>/dev/tcp/${dbHost}/5432' 2>/dev/null; do echo "Waiting for ${dbHost}:5432"; sleep 2; done`,
    ],
    securityContext: {
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
      capabilities: { drop: ["ALL"] },
    },
    resources: {
      requests: { cpu: "50m", memory: "32Mi" },
      limits: { cpu: "100m", memory: "64Mi" },
    },
  };
}

/**
 * Generate the Backstage CR object for the operator path.
 *
 * The CR uses spec.deployment.patch to override the container image and
 * spec.application for app-config, dynamic plugins, extra files, env vars,
 * and route configuration.
 */
export function generateBackstageCR(config: RuntimeDeployConfig): BackstageCR {
  const fullImage = imageRefToString(config.image);
  const cloudSql = config.cloudSql;
  const external = config.externalPostgres;

  const envs: Array<Record<string, unknown>> = [
    { name: "NODE_OPTIONS", value: "--no-node-snapshot" },
    { name: "NODE_ENV", value: "production" },
    { name: "NODE_TLS_REJECT_UNAUTHORIZED", value: "0" },
  ];

  // CATALOG_INDEX_IMAGE override — mirrors the yq injection in
  // .ci/pipelines/install-methods/operator.sh.
  // The `containers` field targets only the install-dynamic-plugins init
  // container so the env var doesn't leak into the main backstage-backend.
  if (config.catalogIndex) {
    const fullRef = imageRefToString(config.catalogIndex);
    envs.push({
      name: "CATALOG_INDEX_IMAGE",
      value: fullRef,
      containers: ["install-dynamic-plugins"],
    });
  }

  return {
    kind: "Backstage",
    apiVersion: BACKSTAGE_CR_API_VERSION,
    metadata: {
      name: config.releaseName,
      // Operator list merging otherwise appends new init containers after defaults.
      ...(cloudSql
        ? { annotations: { "rhdh.redhat.com/deployment-patch-list-merge-mode": "prepend" } }
        : {}),
    },
    spec: {
      ...(external
        ? { database: { enableLocalDb: false, authSecretName: RUNTIME_DB_SECRET } }
        : {}),
      ...(cloudSql
        ? { database: { enableLocalDb: false, authSecretName: CLOUD_SQL_DB_SECRET } }
        : {}),
      deployment: {
        patch: {
          spec: {
            replicas: 1,
            strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 0, maxUnavailable: 1 } },
            template: {
              ...(config.revision === undefined
                ? {}
                : {
                    metadata: { annotations: { "rhdh.redhat.com/runtime-run": config.revision } },
                  }),
              ...(cloudSql
                ? {
                    metadata: {
                      annotations: {
                        "rhdh.redhat.com/cloudsql-revision": cloudSql.revision,
                      },
                    },
                  }
                : {}),
              spec: {
                containers: [
                  {
                    name: BACKSTAGE_BACKEND_CONTAINER,
                    image: fullImage,
                  },
                  ...(cloudSql ? [buildCloudSqlEntityServer(fullImage)] : []),
                ],
                initContainers: [
                  ...(cloudSql ? [buildCloudSqlProxy(cloudSql.instanceConnectionName)] : []),
                  { name: "install-dynamic-plugins", image: fullImage },
                  generateWaitForDbInitContainer(
                    fullImage,
                    cloudSql
                      ? "127.0.0.1"
                      : (external?.host ?? `backstage-psql-${config.releaseName}`),
                  ),
                ],
                volumes: [
                  ...(cloudSql
                    ? [
                        buildCloudSqlProxyVolume(),
                        {
                          name: "cloud-sql-entity",
                          configMap: { name: "cloud-sql-entity" },
                        },
                      ]
                    : []),
                  {
                    name: "dynamic-plugins-root",
                    $patch: "replace",
                    persistentVolumeClaim: {
                      claimName: `${config.releaseName}-dynamic-plugins-root`,
                    },
                  },
                ],
              },
            },
          },
        },
      },
      application: {
        appConfig: {
          configMaps: [{ name: "app-config-rhdh" }],
          mountPath: "/opt/app-root/src",
        },
        dynamicPluginsConfigMapName: "dynamic-plugins",
        extraFiles: {
          mountPath: "/opt/app-root/src",
          secrets: [{ name: "postgres-crt", key: "postgres-crt.pem" }],
        },
        extraEnvs: {
          envs,
          secrets: [
            { name: "rhdh-runtime-config" },
            ...(cloudSql
              ? [
                  {
                    name: CLOUD_SQL_DB_SECRET,
                    key: "CLOUDSQL_API_TOKEN",
                    containers: [BACKSTAGE_BACKEND_CONTAINER],
                  },
                ]
              : []),
          ],
        },
        route: { enabled: true },
      },
      // Disable all default flavours (e.g. lightspeed) to avoid unnecessary
      // sidecar containers and init containers that slow down startup and
      // restarts.  Runtime tests don't need lightspeed — they only test
      // ConfigMap changes and DB connectivity.
      flavours: [],
    },
  };
}
