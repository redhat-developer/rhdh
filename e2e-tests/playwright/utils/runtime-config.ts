/**
 * Runtime deployment configuration — single source of truth.
 *
 * Generates Helm values and Operator Backstage CR from a shared config,
 * ensuring both install methods stay in sync.
 *
 * Design:
 *   - Shared constants live here (app title, guest auth, dynamic plugins, …).
 *   - Helm values YAML is generated with ONLY the overrides that differ from
 *     the chart defaults.  Arrays (extraVolumes, extraVolumeMounts) must be
 *     specified in full because Helm replaces arrays rather than merging them.
 *   - Operator ConfigMaps / Backstage CR are generated programmatically.
 *   - CATALOG_INDEX_IMAGE opt-in override: Helm uses
 *     `global.catalogIndex.image.*` --set flags; Operator pushes an env var
 *     with `containers: ["install-dynamic-plugins"]`.
 */

import * as yaml from "js-yaml";
import {
  type ImageRef,
  imageRefToString,
  parseCatalogIndexImage,
} from "./helper";

// Re-export image utilities so existing `import from "./runtime-config"`
// callers continue to work without changes.
export { type ImageRef, imageRefToString, parseCatalogIndexImage };

// ─── Shared constants ────────────────────────────────────────────────────────

const appTitle = "Red Hat Developer Hub";
const dynamicPluginsPvcSize = "5Gi";

/** Backstage CRD API version — update when the CRD version bumps. */
export const BACKSTAGE_CR_API_VERSION = "rhdh.redhat.com/v1alpha5";

// ─── Resolved configuration ─────────────────────────────────────────────────

export interface RuntimeDeployConfig {
  releaseName: string;
  namespace: string;
  routerBase: string;
  image: { registry: string; repository: string; tag: string };
  catalogIndex?: ImageRef;
  helm?: { chartUrl: string; chartVersion: string };
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
  const releaseName = process.env.RELEASE_NAME || "rhdh";
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const imageRegistry = process.env.IMAGE_REGISTRY || "quay.io";
  const imageRepo = process.env.IMAGE_REPO || "rhdh-community/rhdh";
  const imageTag = process.env.TAG_NAME || "next";

  const config: RuntimeDeployConfig = {
    releaseName,
    namespace,
    routerBase,
    image: { registry: imageRegistry, repository: imageRepo, tag: imageTag },
  };

  // CATALOG_INDEX_IMAGE opt-in override
  if (process.env.CATALOG_INDEX_IMAGE) {
    config.catalogIndex = parseCatalogIndexImage(
      process.env.CATALOG_INDEX_IMAGE,
    );
  }

  // Helm-specific
  const chartUrl = process.env.HELM_CHART_URL || "oci://quay.io/rhdh/chart";
  const chartVersion = process.env.CHART_VERSION;
  if (chartVersion) {
    config.helm = { chartUrl, chartVersion };
  }

  return config;
}

// ─── Helm values generation ──────────────────────────────────────────────────

/**
 * Generate a Helm values YAML string containing ONLY the overrides that
 * differ from the chart defaults.
 *
 * Values omitted (inherited from chart defaults):
 *   - global.dynamic.{includes, plugins}
 *   - upstream.nameOverride
 *   - upstream.backstage.appConfig.{app.baseUrl, backend.baseUrl, cors, externalAccess}
 *   - upstream.backstage.extraEnvVars (BACKEND_SECRET, POSTGRESQL_ADMIN_PASSWORD)
 *   - upstream.backstage.installDir
 *   - upstream.postgresql.enabled
 *
 * Arrays (extraVolumes, extraVolumeMounts) include chart-default entries
 * because Helm replaces arrays entirely — we add postgres-crt and change
 * dynamic-plugins-root from ephemeral to PVC.
 */
export function generateHelmValuesYaml(): string {
  // Build the YAML as a plain object, then dump.
  // Helm template expressions are embedded as literal strings — Helm's
  // template engine evaluates them at render time regardless of whether
  // values come from a file or stdin.
  const tpl = (expr: string) => `{{ ${expr} }}`;
  const printfRelease = (suffix: string) =>
    tpl(`printf "%s-${suffix}" .Release.Name`);

  const values = {
    global: {
      lightspeed: { enabled: false },
    },
    upstream: {
      commonLabels: { "backstage.io/kubernetes-id": "developer-hub" },
      backstage: {
        image: { pullPolicy: "Always" },
        appConfig: {
          app: { title: appTitle },
          auth: {
            environment: "development",
            providers: {
              guest: { dangerouslyAllowOutsideDevelopment: true },
            },
          },
        },
        // Volume mounts — chart defaults + postgres-crt
        extraVolumeMounts: [
          {
            name: "dynamic-plugins-root",
            mountPath: "/opt/app-root/src/dynamic-plugins-root",
          },
          { name: "extensions-catalog", mountPath: "/extensions" },
          { name: "temp", mountPath: "/tmp" },
          // Runtime addition: postgres certificate for external DB tests
          {
            name: "postgres-crt",
            mountPath: "/opt/app-root/src/postgres-crt.pem",
            subPath: "postgres-crt.pem",
          },
        ],
        // Volumes — PVC for dynamic-plugins-root + chart defaults + postgres-crt
        extraVolumes: [
          // PVC instead of chart-default ephemeral — persists plugins across
          // deployment restarts (config-map and schema-mode tests both restart RHDH)
          {
            name: "dynamic-plugins-root",
            persistentVolumeClaim: {
              claimName: printfRelease("dynamic-plugins-root"),
            },
          },
          // Chart defaults (must repeat because Helm replaces arrays)
          {
            name: "dynamic-plugins",
            configMap: {
              defaultMode: 420,
              name: printfRelease("dynamic-plugins"),
              optional: true,
            },
          },
          {
            name: "dynamic-plugins-npmrc",
            secret: {
              defaultMode: 420,
              optional: true,
              secretName: printfRelease("dynamic-plugins-npmrc"),
            },
          },
          {
            name: "dynamic-plugins-registry-auth",
            secret: {
              defaultMode: 416,
              optional: true,
              secretName: printfRelease("dynamic-plugins-registry-auth"),
            },
          },
          // Runtime addition
          {
            name: "postgres-crt",
            secret: { secretName: "postgres-crt", optional: true },
          },
          { name: "npmcacache", emptyDir: {} },
          { name: "extensions-catalog", emptyDir: {} },
          { name: "temp", emptyDir: {} },
        ],
      },
    },
  };

  // js-yaml's dump wraps strings with {{ in quotes, which is correct for
  // Helm — template expressions in values.yaml are always quoted strings.
  return yaml.dump(values, {
    lineWidth: -1,
    quotingType: "'",
    forceQuotes: false,
  });
}

/**
 * Generate the `--set` arguments for `helm upgrade -i`.
 *
 * These are values that must be resolved at deploy time (cluster-specific
 * or image-specific), not baked into the values YAML.
 */
export function generateHelmSetArgs(config: RuntimeDeployConfig): string[] {
  const args: string[] = [
    "--set",
    `global.clusterRouterBase=${config.routerBase}`,
    "--set",
    `upstream.backstage.image.registry=${config.image.registry}`,
    "--set",
    `upstream.backstage.image.repository=${config.image.repository}`,
    "--set",
    `upstream.backstage.image.tag=${config.image.tag}`,
  ];

  // CATALOG_INDEX_IMAGE override — mirrors helm::get_image_params() in
  // .ci/pipelines/lib/helm.sh.  When not set, the chart's built-in
  // global.catalogIndex default takes effect (quay.io/rhdh/plugin-catalog-index:1.10).
  if (config.catalogIndex) {
    args.push(
      "--set",
      `global.catalogIndex.image.registry=${config.catalogIndex.registry}`,
      "--set",
      `global.catalogIndex.image.repository=${config.catalogIndex.repository}`,
      "--set",
      `global.catalogIndex.image.tag=${config.catalogIndex.tag}`,
    );
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
export function generateAppConfigYaml(runtimeUrl: string): string {
  const appConfig = {
    app: {
      title: appTitle,
      baseUrl: runtimeUrl,
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
    },
    auth: {
      environment: "development",
      providers: {
        guest: { dangerouslyAllowOutsideDevelopment: true },
      },
    },
  };

  return yaml.dump(appConfig, { lineWidth: -1 });
}

// ─── Operator dynamic-plugins ConfigMap ──────────────────────────────────────

/**
 * Generate the dynamic-plugins.yaml content for the operator path.
 *
 * Runtime tests only need a basic RHDH instance (config-map changes, DB
 * connectivity).  We set `includes: []` to prevent loading
 * `dynamic-plugins.default.yaml` — many of its default-enabled plugins
 * crash without external config (GitHub org, GitLab, LDAP, Keycloak,
 * ArgoCD, Kubernetes, orchestrator, etc.) and block the readiness probe.
 */
export function generateDynamicPluginsYaml(): string {
  return yaml.dump(
    { includes: [] as string[], plugins: [] as unknown[] },
    { lineWidth: -1 },
  );
}

// ─── Operator Backstage CR generation ────────────────────────────────────────

/**
 * Generate the Backstage CR object for the operator path.
 *
 * The CR uses spec.deployment.patch to override the container image and
 * spec.application for app-config, dynamic plugins, extra files, env vars,
 * and route configuration.
 */
export function generateBackstageCR(config: RuntimeDeployConfig): BackstageCR {
  const fullImage = `${config.image.registry}/${config.image.repository}:${config.image.tag}`;

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
    metadata: { name: config.releaseName },
    spec: {
      deployment: {
        patch: {
          spec: {
            template: {
              spec: {
                containers: [{ name: "backstage-backend", image: fullImage }],
                initContainers: [
                  { name: "install-dynamic-plugins", image: fullImage },
                ],
                volumes: [
                  {
                    name: "dynamic-plugins-root",
                    ephemeral: {
                      volumeClaimTemplate: {
                        spec: {
                          accessModes: ["ReadWriteOnce"],
                          resources: {
                            requests: { storage: dynamicPluginsPvcSize },
                          },
                        },
                      },
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
          secrets: [{ name: "rhdh-runtime-config" }],
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
