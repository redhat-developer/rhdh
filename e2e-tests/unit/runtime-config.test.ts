import { describe, expect, it } from "vitest";
import * as yaml from "yaml";

import { buildImageRef } from "../playwright/utils/helper";
import { isRecord } from "../playwright/utils/kube-client/helpers";
import {
  generateBackstageCR,
  generateHelmSetArgs,
  generateHelmValuesYaml,
  type RuntimeDeployConfig,
} from "../playwright/utils/runtime-config";

const config: RuntimeDeployConfig = {
  releaseName: "rhdh",
  namespace: "showcase-runtime",
  routerBase: "apps.cluster.example.io",
  image: buildImageRef("quay.io", "rhdh-community/rhdh", "next"),
  internalPostgresqlImage: buildImageRef("quay.io", "fedora/postgresql-18", "latest"),
};
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

  it("disables the Intelligent Assistant sidecar", () => {
    expect(helmValues()).toMatchObject({ intelligentAssistant: { enabled: false } });
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
