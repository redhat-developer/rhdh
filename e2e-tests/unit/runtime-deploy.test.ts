import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readDeployment: vi.fn<(name: string, namespace: string) => Promise<unknown>>(),
  getRoute: vi.fn<(...args: string[]) => Promise<unknown>>(),
  deleteNamespace: vi.fn<(namespace: string) => Promise<void>>(),
  secret: vi.fn<(body: unknown, namespace: string) => Promise<void>>(),
  pvc: vi.fn<(namespace: string, body: unknown) => Promise<unknown>>(),
  waitReady:
    vi.fn<(name: string, namespace: string, count: number, timeout: number) => Promise<void>>(),
  run: vi.fn<
    (command: string, args: string[], options?: { timeout?: number }) => Promise<string>
  >(),
}));
vi.mock("../playwright/utils/kube-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../playwright/utils/kube-client")>();
  return {
    ...original,
    KubeClient: class {
      appsApi = { readNamespacedDeployment: mocks.readDeployment };
      customObjectsApi = { getNamespacedCustomObject: mocks.getRoute };
      coreV1Api = { createNamespacedPersistentVolumeClaim: mocks.pvc };
      deleteNamespaceIfExists = mocks.deleteNamespace;
      createOrUpdateSecret = mocks.secret;
      waitForDeploymentReady = mocks.waitReady;
    },
  };
});
vi.mock("../playwright/utils/helper", async (importOriginal) => {
  const original = await importOriginal<typeof import("../playwright/utils/helper")>();
  return { ...original, run: mocks.run };
});

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    INSTALL_METHOD: "helm",
    RELEASE_NAME: "rhdh",
    NAME_SPACE_RUNTIME: "ordinary-runtime",
    K8S_CLUSTER_ROUTER_BASE: "apps.example.test",
    BASE_URL: "",
    CHART_VERSION: "2.2-14-CI",
    SCHEMA_MODE_DB_ADMIN_PASSWORD: "internal-admin",
    POSTGRESQL_IMAGE_REGISTRY: "quay.io",
    POSTGRESQL_IMAGE_REPO: "fedora/postgresql-18",
    POSTGRESQL_IMAGE_TAG: "latest",
  }))
    vi.stubEnv(key, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime target reuse", () => {
  it("publishes the actual route of an existing ready deployment", async () => {
    mocks.readDeployment.mockResolvedValue({ body: { status: { readyReplicas: 1 } } });
    mocks.getRoute.mockResolvedValue({ body: { spec: { host: "existing.example.test" } } });
    const { ensureRuntimeDeployed } = await import("../playwright/utils/runtime-deploy");
    await ensureRuntimeDeployed();
    expect(process.env.BASE_URL).toBe("https://existing.example.test");
    expect(mocks.deleteNamespace).not.toHaveBeenCalled();
  });
  it("does not mistake a route lookup failure for an absent deployment", async () => {
    mocks.readDeployment.mockResolvedValue({ body: { status: { readyReplicas: 1 } } });
    mocks.getRoute.mockRejectedValue({ statusCode: 404 });
    const { ensureRuntimeDeployed } = await import("../playwright/utils/runtime-deploy");
    await expect(ensureRuntimeDeployed()).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.deleteNamespace).not.toHaveBeenCalled();
  });
  it("propagates Kubernetes permission failures without deleting the namespace", async () => {
    mocks.readDeployment.mockRejectedValue({ statusCode: 403 });
    const { ensureRuntimeDeployed } = await import("../playwright/utils/runtime-deploy");
    await expect(ensureRuntimeDeployed()).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.deleteNamespace).not.toHaveBeenCalled();
  });
  it("deploys an explicit Cloud SQL target without changing default URL or schema configuration", async () => {
    vi.stubEnv("BASE_URL", "https://ordinary.example.test");
    mocks.getRoute.mockResolvedValue({ body: { spec: { host: "cloudsql.example.test" } } });
    const { KubeClient } = await import("../playwright/utils/kube-client");
    const { buildCloudSqlProxy } = await import("../playwright/utils/cloudsql-config");
    const { resolveConfig } = await import("../playwright/utils/runtime-config");
    const { deployRuntime } = await import("../playwright/utils/runtime-deploy");
    const config = resolveConfig("apps.example.test");
    config.namespace = "isolated-cloudsql";
    config.releaseName = "cloudsql";
    config.cloudSql = {
      instanceConnectionName: "p:r:i",
      user: "db-user",
      databasePrefix: "csql_012345abcdef_1_",
      revision: "revision",
    };
    mocks.readDeployment.mockResolvedValue({
      body: {
        metadata: { generation: 1 },
        spec: {
          replicas: 1,
          template: {
            metadata: { annotations: { "rhdh.redhat.com/cloudsql-revision": "revision" } },
            spec: { initContainers: [buildCloudSqlProxy("p:r:i")] },
          },
        },
        status: {
          observedGeneration: 1,
          readyReplicas: 1,
          availableReplicas: 1,
          updatedReplicas: 1,
          replicas: 1,
        },
      },
    });
    const target = await deployRuntime(config, "helm", new KubeClient());
    expect(target).toEqual({
      namespace: "isolated-cloudsql",
      releaseName: "cloudsql",
      deploymentName: "cloudsql-developer-hub",
      baseURL: "https://cloudsql.example.test",
    });
    expect(mocks.run).toHaveBeenCalledWith(
      "helm",
      expect.arrayContaining(["cloudsql", "isolated-cloudsql", "--wait"]),
      expect.any(Object),
    );
    expect(process.env.BASE_URL).toBe("https://ordinary.example.test");
    expect(process.env.SCHEMA_MODE_DB_ADMIN_PASSWORD).toBe("internal-admin");
  });
});
