/* oxlint-disable import/max-dependencies -- fixture coordinates PostgreSQL, Kubernetes, and Playwright */
import type { Client } from "pg";

import { base64Encode, discoverRouterBase, resolveInstallMethod } from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";
import { resolveConfig, RUNTIME_DB_SECRET } from "../../utils/runtime-config";
import {
  connectExternalDatabase,
  clearOwnedDatabases,
  readExternalDatabaseInputs,
  runtimeDatabasePrefix,
  RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
  type ExternalDatabaseProvider,
} from "../../utils/runtime-database";
import { deployRuntime, type RuntimeDeploymentHandle } from "../../utils/runtime-deploy";
import {
  resetRuntimeNamespace,
  deleteOwnedRuntimeNamespace,
  deleteRuntimeApplication,
  stopRuntimeApplication,
  collectRuntimeDiagnostics,
  runtimeRevision,
} from "../../utils/runtime-lifecycle";
import { test as base } from "../coverage/test";

interface ExternalRuntime extends RuntimeDeploymentHandle {
  databasePrefix: string;
  serverVersion: string;
  connect(database?: string): Promise<Client>;
  restart(): Promise<void>;
}
type Target = { provider: ExternalDatabaseProvider; slot: number };
type RuntimeEntry = { runtime: ExternalRuntime; dispose(): Promise<void> };
type TestFixtures = {
  externalTarget: Target;
  externalRuntime: ExternalRuntime | null;
  runtimeEvidence: void;
};
type WorkerFixtures = {
  externalRuntimeManager: { get(target: Target): Promise<ExternalRuntime | null> };
};

/** One explicitly keyed target at a time; a replacement worker rebuilds its owned resources. */
async function createExternalRuntime({ provider, slot }: Target): Promise<RuntimeEntry | null> {
  const inputs = readExternalDatabaseInputs(provider, slot);
  if (!inputs) return null;
  const runId = process.env.RUNTIME_RUN_ID ?? "";
  const prefix = runtimeDatabasePrefix(runId, provider, slot);
  const config = resolveConfig(await discoverRouterBase());
  config.namespace = `${config.namespace.slice(0, 15).replace(/-+$/u, "")}-${provider}${slot}-${runId}`;
  config.revision = runtimeRevision();
  config.externalPostgres = {
    host: inputs.host,
    port: inputs.port,
    user: inputs.user,
    databasePrefix: prefix,
  };
  const method = resolveInstallMethod();
  const kube = new KubeClient();
  const admin = await connectExternalDatabase(inputs);
  let serverVersion: string;
  try {
    const version = await admin.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    serverVersion = version.rows[0].version;
  } finally {
    await admin.end();
  }
  await resetRuntimeNamespace(kube, config.namespace, runId);
  const clients = new Set<Client>();
  const dispose = async () => {
    const errors: unknown[] = [];
    let stopped = false;
    try {
      await deleteRuntimeApplication(kube, config.namespace, config.releaseName, method);
      stopped = true;
    } catch (error) {
      errors.push(error);
    }
    try {
      await Promise.all([...clients].map((client) => client.end()));
    } catch (error) {
      errors.push(error);
    }
    if (stopped) {
      try {
        const cleanup = await connectExternalDatabase(
          inputs,
          "postgres",
          RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
        );
        try {
          await clearOwnedDatabases(cleanup, prefix);
        } finally {
          await cleanup.end();
        }
        console.log(`Verified cleanup of owned ${provider} databases: ${prefix}`);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await deleteOwnedRuntimeNamespace(kube, config.namespace, runId);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0)
      throw new AggregateError(
        errors,
        `${provider} slot ${slot} teardown failed: ${errors.map((error) => String(error).replaceAll(inputs.password, "[REDACTED]")).join("; ")}`,
      );
  };
  try {
    const cleanup = await connectExternalDatabase(
      inputs,
      "postgres",
      RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
    );
    try {
      await clearOwnedDatabases(cleanup, prefix);
    } finally {
      await cleanup.end();
    }
    await kube.createOrUpdateSecret(
      {
        metadata: { name: RUNTIME_DB_SECRET },
        data: {
          POSTGRES_HOST: base64Encode(inputs.host),
          POSTGRES_PORT: base64Encode(String(inputs.port)),
          POSTGRES_USER: base64Encode(inputs.user),
          POSTGRES_PASSWORD: base64Encode(inputs.password),
        },
      },
      config.namespace,
    );
    await kube.createOrUpdateSecret(
      {
        metadata: { name: "postgres-crt" },
        data: { "postgres-crt.pem": base64Encode(inputs.certificate) },
      },
      config.namespace,
    );
    const target = await deployRuntime(config, method, kube);
    return {
      dispose,
      runtime: {
        ...target,
        databasePrefix: prefix,
        serverVersion,
        async connect(database) {
          const client = await connectExternalDatabase(inputs, database);
          clients.add(client);
          client.once("end", () => {
            clients.delete(client);
          });
          return client;
        },
        async restart() {
          await stopRuntimeApplication(kube, config.namespace, config.releaseName, method);
          config.revision = runtimeRevision();
          await deployRuntime(config, method, kube);
        },
      },
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Failed to prepare ${provider} slot ${slot}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  externalTarget: [{ provider: "rds", slot: 1 }, { option: true }],
  externalRuntime: [
    async ({ externalTarget, externalRuntimeManager }, use, info) => {
      const runtime = await externalRuntimeManager.get(externalTarget);
      info.skip(runtime === null, "External PostgreSQL not configured for this optional local run");
      await use(runtime);
    },
    { timeout: 1_800_000 },
  ],
  baseURL: async ({ externalRuntime }, use) => {
    if (externalRuntime) await use(externalRuntime.baseURL);
  },
  runtimeEvidence: [
    async ({ externalRuntime, externalTarget }, use, info) => {
      if (!externalRuntime) return;
      const inputs = readExternalDatabaseInputs(externalTarget.provider, externalTarget.slot);
      try {
        await use();
      } finally {
        await info.attach("runtime-database-target", {
          body: JSON.stringify({ ...externalRuntime, connect: undefined, restart: undefined }),
          contentType: "application/json",
        });
        await collectRuntimeDiagnostics(
          new KubeClient(),
          externalRuntime.namespace,
          info,
          (text) => (inputs ? text.replaceAll(inputs.password, "[REDACTED]") : text),
        );
      }
    },
    { auto: true },
  ],
  externalRuntimeManager: [
    async ({ browserName: _browserName }, use) => {
      const current: { entry: RuntimeEntry | null; key?: string } = { entry: null };
      try {
        await use({
          async get(target) {
            const nextKey = `${target.provider}/${target.slot}`;
            if (nextKey !== current.key) {
              const previous = current.entry;
              current.entry = null;
              current.key = undefined;
              await previous?.dispose();
              current.entry = await createExternalRuntime(target);
              current.key = nextKey;
            }
            return current.entry?.runtime ?? null;
          },
        });
      } finally {
        await current.entry?.dispose();
      }
    },
    { scope: "worker", timeout: 1_800_000 },
  ],
});

export { expect } from "../coverage/test";
