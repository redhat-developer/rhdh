import { afterEach, describe, expect, it, vi } from "vitest";
import * as yaml from "yaml";

import {
  buildImageRef,
  imageRefToString,
  parseCatalogIndexImage,
} from "../playwright/utils/helper";
import { isRecord } from "../playwright/utils/kube-client/helpers";
import {
  generateAppConfigYaml,
  generateBackstageCR,
  generateDynamicPluginsYaml,
  generateHelmSetArgs,
  generateHelmValuesYaml,
  type RuntimeDeployConfig,
  resolveConfig,
} from "../playwright/utils/runtime-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("keeps the CI-resolved digest when a moving application tag changes", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  vi.stubEnv("IMAGE_DIGEST", digest);
  vi.stubEnv("IMAGE_REGISTRY", "quay.io");
  vi.stubEnv("IMAGE_REPO", "rhdh-community/rhdh");
  vi.stubEnv("TAG_NAME", "next");
  vi.stubEnv("POSTGRESQL_IMAGE_REGISTRY", "quay.io");
  vi.stubEnv("POSTGRESQL_IMAGE_REPO", "fedora/postgresql-18");
  vi.stubEnv("POSTGRESQL_IMAGE_TAG", "latest");
  const initial = resolveConfig("apps.example.test");
  vi.stubEnv("TAG_NAME", "changed-after-startup");
  expect(imageRefToString(resolveConfig("apps.example.test").image)).toBe(
    imageRefToString(initial.image),
  );
  expect(imageRefToString(initial.image)).toBe(`quay.io/rhdh-community/rhdh@${digest}`);
});

const config: RuntimeDeployConfig = {
  releaseName: "rhdh",
  namespace: "showcase-runtime",
  routerBase: "apps.cluster.example.io",
  image: buildImageRef("quay.io", "rhdh-community/rhdh", "next"),
  internalPostgresqlImage: buildImageRef("quay.io", "fedora/postgresql-18", "latest"),
};
const guestProviderPackage = /backstage-plugin-auth-backend-module-guest-provider/u;
const catalogIndex = buildImageRef("quay.io", "rhdh/plugin-catalog-index", "next");

/** Collapses ["--set", "k=v", ...] into { k: "v" } so tests assert on keys, not positions. */
function setValues(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    expect(args[i]).toBe("--set");
    const [key, ...rest] = args[i + 1].split("=");
    values[key] = rest.join("=");
  }
  return values;
}

/** The generated Helm values, parsed. */
function helmValues(): Record<string, unknown> {
  const parsed: unknown = yaml.parse(generateHelmValuesYaml());
  if (!isRecord(parsed)) throw new Error("Helm values are not a YAML mapping");
  return parsed;
}

describe("generateHelmSetArgs", () => {
  it("routes the cluster router base through openshift.clusterRouterBase", () => {
    expect(setValues(generateHelmSetArgs(config))).toMatchObject({
      "openshift.clusterRouterBase": "apps.cluster.example.io",
    });
  });

  it("sets the RHDH image at the top level and clears the chart default digest", () => {
    expect(setValues(generateHelmSetArgs(config))).toMatchObject({
      "image.registry": "quay.io",
      "image.repository": "rhdh-community/rhdh",
      "image.tag": "next",
      "image.digest": "",
    });
  });

  it("sets the internal PostgreSQL image and clears its digest", () => {
    expect(setValues(generateHelmSetArgs(config))).toMatchObject({
      "postgresql.image.registry": "quay.io",
      "postgresql.image.repository": "fedora/postgresql-18",
      "postgresql.image.tag": "latest",
      "postgresql.image.digest": "",
    });
  });

  it("emits no 1.x keys, which the 2.y chart silently ignores", () => {
    const keys = Object.keys(setValues(generateHelmSetArgs({ ...config, catalogIndex })));

    expect(keys.filter((key) => /^(global|upstream)\./u.test(key))).toEqual([]);
  });

  it("passes a digest-pinned catalog index as a digest, not as a tag", () => {
    const digest = "sha256:dd907085d2b535c5b34a95a8d1050ec5374f7685e76355332c4916a01c2568ee";
    const pinned = parseCatalogIndexImage(`quay.io/rhdh/plugin-catalog-index@${digest}`);

    expect(setValues(generateHelmSetArgs({ ...config, catalogIndex: pinned }))).toMatchObject({
      "catalogIndex.image.repository": "rhdh/plugin-catalog-index",
      "catalogIndex.image.tag": "",
      "catalogIndex.image.digest": digest,
    });
  });

  it("passes a digest-pinned RHDH image as a digest", () => {
    const digest = "sha256:7baeebc72e5b719edc59e8651de7cf4627784fe43e7a084b8472f3072678c27d";
    const pinned = buildImageRef("quay.io", "rhdh/rhdh-hub-rhel10", digest);

    expect(setValues(generateHelmSetArgs({ ...config, image: pinned }))).toMatchObject({
      "image.tag": "",
      "image.digest": digest,
    });
  });

  it("overrides the catalog index image only when one is configured", () => {
    const withoutOverride = Object.keys(setValues(generateHelmSetArgs(config)));

    expect(withoutOverride.some((key) => key.startsWith("catalogIndex."))).toBe(false);
    expect(setValues(generateHelmSetArgs({ ...config, catalogIndex }))).toMatchObject({
      "catalogIndex.image.registry": "quay.io",
      "catalogIndex.image.repository": "rhdh/plugin-catalog-index",
      "catalogIndex.image.tag": "next",
      "catalogIndex.image.digest": "",
    });
  });
});

describe("generateHelmValuesYaml", () => {
  it("keeps Segment in test mode alongside the catalog probe token", () => {
    expect(helmValues()).toMatchObject({
      extraEnv: [{ name: "SEGMENT_TEST_MODE", value: "true" }],
    });
    expect(yaml.parse(generateHelmValuesYaml({ ...config, catalogProbe: true }))).toMatchObject({
      extraEnv: [
        { name: "SEGMENT_TEST_MODE", value: "true" },
        { name: "RUNTIME_CATALOG_API_TOKEN", valueFrom: { secretKeyRef: {} } },
      ],
    });
  });

  it("uses only 2.y top-level keys", () => {
    expect(Object.keys(helmValues())).not.toContain("global");
    expect(Object.keys(helmValues())).not.toContain("upstream");
  });

  it("switches dynamic-plugins-root to the PVC created by runtime-deploy", () => {
    expect(helmValues()).toMatchObject({
      dynamicPlugins: {
        volume: {
          type: "pvc",
          pvc: { claimName: '{{ printf "%s-dynamic-plugins-root" .Release.Name }}' },
        },
      },
    });
  });

  it("adds only the postgres-crt volume, leaving the system volumes to the chart", () => {
    expect(helmValues()).toMatchObject({
      extraVolumes: [
        { name: "postgres-crt", secret: { secretName: "postgres-crt", optional: true } },
      ],
      extraVolumeMounts: [{ name: "postgres-crt", subPath: "postgres-crt.pem" }],
    });
  });

  it("lets the backend reach external databases past the chart's default-deny egress", () => {
    expect(helmValues()).toMatchObject({
      extraDeploy: [
        {
          kind: "NetworkPolicy",
          spec: {
            podSelector: {
              matchLabels: {
                "app.kubernetes.io/instance": "{{ .Release.Name }}",
                "app.kubernetes.io/component": "backstage",
              },
            },
            policyTypes: ["Egress"],
            egress: [{}],
          },
        },
      ],
    });
  });

  it("enables the guest auth provider, which the catalog index ships disabled", () => {
    expect(helmValues()).toMatchObject({ dynamicPlugins: { plugins: [{ enabled: true }] } });
    expect(generateHelmValuesYaml()).toMatch(guestProviderPackage);
  });

  it("uses the catalog Homepage 3.1 page and layout", () => {
    expect(helmValues()).toMatchObject({
      appConfig: {
        app: {
          extensions: [
            { "page:home": false },
            { "page:homepage": { config: { path: "/", title: "Home" } } },
            { "translation:app/homepage-translations": true },
            {
              "home-page-layout:homepage/dynamic-homepage-layout": {
                config: { customizable: false },
              },
            },
            { "api:home/visits": true },
            { "app-root-element:home/visit-listener": true },
          ],
        },
      },
    });
  });

  it("disables the Intelligent Assistant sidecar", () => {
    expect(helmValues()).toMatchObject({ intelligentAssistant: { enabled: false } });
  });
});

describe("generateDynamicPluginsYaml", () => {
  it("loads the same RHDH frontend defaults as Helm and enables guest authentication", () => {
    expect(yaml.parse(generateDynamicPluginsYaml())).toMatchObject({
      includes: ["dynamic-plugins.default.yaml"],
      plugins: [{ enabled: true }],
    });
    expect(generateDynamicPluginsYaml()).toMatch(guestProviderPackage);
  });
});

describe("generateBackstageCR", () => {
  type InitContainer = { name: string; image?: string; command?: string[] };
  type PodSpecPatch = { spec: { template: { spec: { initContainers: InitContainer[] } } } };

  /** The init containers the CR patches into the operator deployment. */
  function initContainers(): InitContainer[] {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the CR patch is loosely typed
    const patch = generateBackstageCR(config).spec.deployment?.patch as PodSpecPatch;
    return patch.spec.template.spec.initContainers;
  }

  it("sets Segment test mode on operator runtime deployments", () => {
    const application = generateBackstageCR(config).spec.application;
    if (!isRecord(application) || !isRecord(application.extraEnvs)) {
      throw new Error("Operator extraEnvs are missing");
    }
    expect(application.extraEnvs.envs).toContainEqual({ name: "SEGMENT_TEST_MODE", value: "true" });
  });

  it("waits for the release PostgreSQL service before Backstage starts", () => {
    const waitForDb = initContainers().find((container) => container.name === "wait-for-db");

    expect(waitForDb).toMatchObject({ image: "quay.io/rhdh-community/rhdh:next" });
    expect(waitForDb?.command?.join(" ")).toContain("/dev/tcp/backstage-psql-rhdh/5432");
  });

  it("keeps install-dynamic-plugins on the RHDH image", () => {
    expect(initContainers()).toContainEqual({
      name: "install-dynamic-plugins",
      image: "quay.io/rhdh-community/rhdh:next",
    });
  });
});

it("uses the same home page extensions for Helm and Operator runtime deployments", () => {
  const helm = helmValues();
  if (!isRecord(helm.appConfig) || !isRecord(helm.appConfig.app)) {
    throw new Error("Helm app config is missing");
  }
  const operator: unknown = yaml.parse(generateAppConfigYaml("https://runtime.example.test"));
  expect(operator).toMatchObject({ app: { extensions: helm.appConfig.app.extensions } });
});
