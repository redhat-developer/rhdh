/* oxlint-disable import/max-dependencies -- fixture coordinates PostgreSQL, Kubernetes, and Playwright */
import type { Client } from "pg";

import { base64Encode, discoverRouterBase, resolveInstallMethod } from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";
import { createRuntimeCatalogProbe } from "../../utils/runtime-catalog";
import { resolveConfig, RUNTIME_DB_SECRET } from "../../utils/runtime-config";
import {
  connectExternalDatabase,
  clearOwnedDatabases,
  closeDatabaseClients,
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
  collectRuntimeDiagnostics,
  runtimeRevision,
} from "../../utils/runtime-lifecycle";
import { restartRuntime } from "../../utils/runtime-restart";
import { verifyRuntimeRejectsUntrustedCa } from "../../utils/runtime-tls";
import { test as base } from "../coverage/test";
import { withRuntimeRequest } from "./runtime-request";

interface ExternalRuntime extends RuntimeDeploymentHandle {
  databasePrefix: string;
  entityName: string;
  apiToken: string;
  connect(database?: string): Promise<Client>;
  restart(whileStopped?: () => Promise<void>): Promise<void>;
  verifyUntrustedCa(): Promise<void>;
}
type Target = { provider: ExternalDatabaseProvider; slot: number };

/** One complete lifecycle per target; teardown errors belong to the test that used it. */
export const test = base.extend<{
  externalTarget: Target;
  externalRuntime: ExternalRuntime;
}>({
  externalTarget: [{ provider: "rds", slot: 1 }, { option: true }],
  request: async (
    { playwright, externalRuntime, ignoreHTTPSErrors, extraHTTPHeaders, proxy },
    use,
  ) => {
    await withRuntimeRequest(
      playwright,
      externalRuntime.baseURL,
      { ignoreHTTPSErrors, extraHTTPHeaders, proxy },
      use,
    );
  },
  externalRuntime: [
    async ({ externalTarget: { provider, slot } }, use, info) => {
      const inputs = readExternalDatabaseInputs(provider, slot);
      info.skip(inputs === null, `${provider} slot ${slot} is not configured`);
      if (!inputs) return;
      const runId = process.env.RUNTIME_RUN_ID ?? "";
      const prefix = runtimeDatabasePrefix(runId, provider, slot);
      const config = resolveConfig(await discoverRouterBase());
      config.namespace = `${config.namespace.slice(0, 15).replace(/-+$/u, "")}-${provider}${slot}-${runId}`;
      config.revision = runtimeRevision();
      config.catalogProbe = true;
      config.externalPostgres = {
        host: inputs.host,
        port: inputs.port,
        user: inputs.user,
        databasePrefix: prefix,
      };
      const method = resolveInstallMethod();
      const kube = new KubeClient();
      const namespace = config.namespace;
      const clients = new Set<Client>();
      let apiToken = "";
      const redact = (text: string) => {
        const safe = text.replaceAll(inputs.password, "[REDACTED]");
        return apiToken === "" ? safe : safe.replaceAll(apiToken, "[REDACTED]");
      };
      info.annotations.push(
        { type: "namespace", description: namespace },
        { type: "database", description: `${provider} slot ${slot}` },
      );
      await resetRuntimeNamespace(kube, namespace, runId);
      let setupError: unknown;
      try {
        const admin = await connectExternalDatabase(
          inputs,
          "postgres",
          RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
        );
        try {
          await clearOwnedDatabases(admin, prefix);
          const version = await admin.query<{ version: string; version_number: string }>(
            "SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS version_number",
          );
          await info.attach("runtime-database-target", {
            body: JSON.stringify({
              provider,
              slot,
              namespace,
              databasePrefix: prefix,
              installMethod: method,
              postgres: version.rows[0],
              chart: config.helm,
              image: config.image,
            }),
            contentType: "application/json",
          });
        } finally {
          await admin.end();
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
          namespace,
        );
        await kube.createOrUpdateSecret(
          {
            metadata: { name: "postgres-crt" },
            data: { "postgres-crt.pem": base64Encode(inputs.certificate) },
          },
          namespace,
        );
        const probe = await createRuntimeCatalogProbe(
          kube,
          namespace,
          `${provider}-${runId}-${slot}`,
        );
        apiToken = probe.apiToken;
        const handle = await deployRuntime(config, method, kube);
        await use({
          ...handle,
          ...probe,
          databasePrefix: prefix,
          async connect(database) {
            const client = await connectExternalDatabase(inputs, database);
            clients.add(client);
            client.once("end", () => {
              clients.delete(client);
            });
            return client;
          },
          restart: (whileStopped) => restartRuntime(kube, config, method, whileStopped),
          verifyUntrustedCa: () =>
            verifyRuntimeRejectsUntrustedCa(kube, config, method, inputs.certificate, info, redact),
        });
      } catch (error) {
        setupError = error;
      }
      await collectRuntimeDiagnostics(kube, namespace, info, redact);
      const errors: unknown[] = [];
      let stopped = false;
      try {
        await deleteRuntimeApplication(kube, namespace, config.releaseName, method);
        stopped = true;
      } catch (error) {
        errors.push(error);
      }
      try {
        await closeDatabaseClients(clients);
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
          await info.attach("runtime-database-cleanup", {
            body: JSON.stringify({ databasePrefix: prefix, completed: true }),
            contentType: "application/json",
          });
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await deleteOwnedRuntimeNamespace(kube, namespace, runId);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        if (setupError !== undefined) errors.unshift(setupError);
        throw new AggregateError(
          errors,
          `${provider} slot ${slot} failed: ${errors.map((error) => redact(String(error))).join("; ")}`,
        );
      }
      if (setupError !== undefined)
        throw setupError instanceof Error
          ? setupError
          : new Error("External database setup failed", { cause: setupError });
    },
    { timeout: 1_800_000 },
  ],
});

export { expect } from "../coverage/test";
