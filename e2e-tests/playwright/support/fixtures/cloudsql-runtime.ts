/* oxlint-disable import/max-dependencies -- coordinates deployment, SQL, diagnostics and Playwright lifecycle */
import { randomBytes } from "node:crypto";

import type { Client } from "pg";

import {
  CLOUD_SQL_DB_SECRET,
  CLOUD_SQL_SA_SECRET,
  cloudSqlDatabasePrefix,
  readCloudSqlInputs,
  isNonEmptyString,
} from "../../utils/cloudsql-config";
import { CloudSqlDatabaseSession } from "../../utils/cloudsql-database";
import { base64Encode, discoverRouterBase, resolveInstallMethod } from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";
import { createRuntimeCatalogProbe } from "../../utils/runtime-catalog";
import { resolveConfig } from "../../utils/runtime-config";
import {
  clearOwnedDatabases,
  RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
} from "../../utils/runtime-database";
import { deployRuntime, type RuntimeDeploymentHandle } from "../../utils/runtime-deploy";
import {
  resetRuntimeNamespace,
  deleteOwnedRuntimeNamespace,
  deleteRuntimeApplication,
  collectRuntimeDiagnostics,
} from "../../utils/runtime-lifecycle";
import { restartRuntime } from "../../utils/runtime-restart";
import { test as base } from "../coverage/test";
import { withRuntimeRequest } from "./runtime-request";

type CloudSqlRuntime = RuntimeDeploymentHandle & {
  databasePrefix: string;
  entityName: string;
  apiToken: string;
  connect(database: string): Promise<Client>;
  restart(whileStopped?: () => Promise<void>): Promise<void>;
};

const ownerLabel = "rhdh.redhat.com/cloudsql-run";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const test = base.extend<{ cloudSqlSlot: number; cloudSqlRuntime: CloudSqlRuntime }>({
  cloudSqlSlot: [1, { option: true }],
  request: async (
    { playwright, cloudSqlRuntime, ignoreHTTPSErrors, extraHTTPHeaders, proxy },
    use,
  ) => {
    await withRuntimeRequest(
      playwright,
      cloudSqlRuntime.baseURL,
      { ignoreHTTPSErrors, extraHTTPHeaders, proxy },
      use,
    );
  },
  cloudSqlRuntime: [
    async ({ cloudSqlSlot }, use, testInfo) => {
      const inputs = readCloudSqlInputs();
      testInfo.skip(inputs === null, "No Cloud SQL instances configured (optional local coverage)");
      if (!inputs) return;
      const instance = inputs.instances[cloudSqlSlot - 1];
      testInfo.skip(instance === undefined, `CLOUDSQL_INSTANCE_${cloudSqlSlot} not configured`);
      if (instance === undefined) return;
      const runId = process.env.CLOUDSQL_RUN_ID ?? "";
      const databasePrefix = cloudSqlDatabasePrefix(runId, cloudSqlSlot);
      if (
        !isNonEmptyString(process.env.K8S_CLUSTER_URL) ||
        !isNonEmptyString(process.env.K8S_CLUSTER_TOKEN)
      ) {
        throw new Error(
          "Cloud SQL runtime requires K8S_CLUSTER_URL and K8S_CLUSTER_TOKEN from the normal E2E setup",
        );
      }
      const installMethod = resolveInstallMethod();
      const config = resolveConfig(await discoverRouterBase());
      if (installMethod === "helm" && !config.helm)
        throw new Error("Cloud SQL Helm runtime requires CHART_VERSION");
      config.namespace = `${config.namespace.slice(0, 20).replace(/-+$/u, "")}-csql-${runId}`;
      config.cloudSql = {
        instanceConnectionName: instance,
        user: inputs.user,
        databasePrefix,
        revision: randomBytes(8).toString("hex"),
      };
      config.catalogProbe = true;
      const entityName = `cloudsql-${runId}-${cloudSqlSlot}`;
      let apiToken = "";
      const redact = (text: string) =>
        apiToken === ""
          ? text.replaceAll(inputs.password, "[REDACTED]")
          : text.replaceAll(inputs.password, "[REDACTED]").replaceAll(apiToken, "[REDACTED]");
      const kube = new KubeClient();
      const namespace = config.namespace;
      testInfo.annotations.push(
        { type: "namespace", description: namespace },
        { type: "database", description: instance.split(":")[2] },
      );
      await resetRuntimeNamespace(kube, namespace, runId, ownerLabel);
      const sql = new CloudSqlDatabaseSession(kube, namespace, inputs.user, inputs.password);
      let sqlReady = false;
      let setupError: unknown;
      try {
        apiToken = (await createRuntimeCatalogProbe(kube, namespace, entityName)).apiToken;
        await kube.createOrUpdateSecret(
          {
            metadata: { name: CLOUD_SQL_SA_SECRET },
            data: {
              "service_account.json": base64Encode(inputs.serviceAccountJson),
            },
          },
          namespace,
        );
        await kube.createOrUpdateSecret(
          {
            metadata: { name: CLOUD_SQL_DB_SECRET },
            data: {
              POSTGRES_HOST: base64Encode("127.0.0.1"),
              POSTGRES_PORT: base64Encode("5432"),
              POSTGRES_USER: base64Encode(inputs.user),
              POSTGRES_PASSWORD: base64Encode(inputs.password),
            },
          },
          namespace,
        );
        const admin = await sql.start(instance, RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS);
        sqlReady = true;
        const version = await (async () => {
          try {
            await clearOwnedDatabases(admin, databasePrefix);
            return await admin.query<{ version: string; version_number: string }>(
              "SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS version_number",
            );
          } finally {
            await admin.end();
          }
        })();
        await testInfo.attach("cloudsql-target", {
          body: JSON.stringify(
            {
              installMethod,
              namespace,
              instance,
              databasePrefix,
              chart: config.helm,
              image: config.image,
              postgres: version.rows[0],
            },
            null,
            2,
          ),
          contentType: "application/json",
        });
        const handle = await deployRuntime(config, installMethod, kube);
        await use({
          ...handle,
          databasePrefix,
          entityName,
          apiToken,
          connect: (database) => sql.connect(database),
          async restart(whileStopped) {
            await restartRuntime(kube, config, installMethod, whileStopped);
          },
        });
      } catch (error) {
        setupError = error;
      }
      // Capture the application and proxy evidence even on setup failure, before deleting it.
      await collectRuntimeDiagnostics(kube, namespace, testInfo, redact);
      const cleanupErrors: unknown[] = [];
      try {
        await deleteRuntimeApplication(kube, namespace, config.releaseName, installMethod, [
          sql.podName,
        ]);
        if (sqlReady) {
          await sql.closeClients();
          const cleanupClient = await sql.connect("postgres", RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS);
          try {
            await clearOwnedDatabases(cleanupClient, databasePrefix);
          } finally {
            await cleanupClient.end();
          }
        }
        await testInfo.attach("cloudsql-cleanup", {
          body: JSON.stringify({ databasePrefix, completed: sqlReady }),
          contentType: "application/json",
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await sql.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await deleteOwnedRuntimeNamespace(kube, namespace, runId, ownerLabel);
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (cleanupErrors.length > 0) {
        const errors = [...(setupError === undefined ? [] : [setupError]), ...cleanupErrors];
        throw new AggregateError(
          errors,
          `Cloud SQL failed for ${databasePrefix}: ${errors.map((error) => redact(String(error))).join("; ")}`,
        );
      }
      if (setupError !== undefined) {
        throw setupError instanceof Error
          ? setupError
          : new Error("Cloud SQL setup failed", { cause: setupError });
      }
    },
    { timeout: 1_800_000 },
  ],
});

export { expect } from "../coverage/test";
