import { existsSync } from "fs";

import { test, expect } from "@support/coverage/test";

import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";
import { clearDatabase } from "../../utils/postgres-config";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";

interface CloudSqlConfig {
  name: string;
  instanceConnectionName: string | undefined;
  host: string | undefined;
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

test.describe("Verify connection with Google Cloud SQL using Auth Proxy sidecar", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const runtimeHarness = new RuntimeHarness(namespace);

  const cloudSqlUser = process.env.CLOUDSQL_USER;
  const cloudSqlPassword = process.env.CLOUDSQL_PASSWORD;
  const serviceAccountJsonPath =
    process.env.CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH ?? "/tmp/secrets/cloudsql-service-account.json";

  const cloudSqlConfigurations: CloudSqlConfig[] = [
    {
      name: "latest-3",
      instanceConnectionName: process.env.CLOUDSQL_INSTANCE_1,
      host: process.env.CLOUDSQL_1_HOST,
    },
    {
      name: "latest-2",
      instanceConnectionName: process.env.CLOUDSQL_INSTANCE_2,
      host: process.env.CLOUDSQL_2_HOST,
    },
    {
      name: "latest-1",
      instanceConnectionName: process.env.CLOUDSQL_INSTANCE_3,
      host: process.env.CLOUDSQL_3_HOST,
    },
    {
      name: "latest",
      instanceConnectionName: process.env.CLOUDSQL_INSTANCE_4,
      host: process.env.CLOUDSQL_4_HOST,
    },
  ];

  test.beforeAll(async ({}, testInfo) => {
    test.info().annotations.push(
      {
        type: "component",
        description: "data-management",
      },
      {
        type: "namespace",
        description: namespace,
      },
    );

    await ensureRuntimeDeployed();

    const firstInstance = cloudSqlConfigurations.find((c) =>
      isNonEmpty(c.instanceConnectionName),
    )?.instanceConnectionName;

    if (
      !isNonEmpty(cloudSqlUser) ||
      !isNonEmpty(cloudSqlPassword) ||
      !isNonEmpty(firstInstance) ||
      !existsSync(serviceAccountJsonPath)
    ) {
      testInfo.skip(
        true,
        "Cloud SQL environment variables not configured (CLOUDSQL_USER, CLOUDSQL_PASSWORD, CLOUDSQL_INSTANCE_*, cloudsql-service-account.json)",
      );
      return;
    }

    console.log("Preparing Cloud SQL Auth Proxy sidecar...");
    await runtimeHarness.prepareForCloudSql({
      serviceAccountJsonPath,
      initialInstanceConnectionName: firstInstance,
      user: cloudSqlUser,
      password: cloudSqlPassword,
    });
  });

  for (const config of cloudSqlConfigurations) {
    test.describe.serial(`Cloud SQL ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async ({}, testInfo) => {
        test.setTimeout(180_000);
        if (!isNonEmpty(config.instanceConnectionName)) {
          testInfo.skip(true, `CLOUDSQL_INSTANCE_* not set for ${config.name} — skipping`);
          return;
        }
        test.info().annotations.push({
          type: "database",
          description: config.instanceConnectionName.split(":")[2] || "unknown",
        });

        if (!isNonEmpty(config.host)) {
          console.warn(`CLOUDSQL_*_HOST not set for ${config.name} — skipping clearDatabase`);
          return;
        }
        if (!isNonEmpty(cloudSqlUser) || !isNonEmpty(cloudSqlPassword)) {
          return;
        }

        // Public IP cleanup without a DB CA PEM: tolerate Cloud SQL server cert.
        await clearDatabase({
          host: config.host,
          user: cloudSqlUser,
          password: cloudSqlPassword,
          ssl: { rejectUnauthorized: false },
        });
      });

      test("Configure and restart deployment", async ({}, testInfo) => {
        if (!isNonEmpty(config.instanceConnectionName)) {
          testInfo.skip(true, `CLOUDSQL_INSTANCE_* not set for ${config.name}`);
          return;
        }
        if (!isNonEmpty(cloudSqlUser) || !isNonEmpty(cloudSqlPassword)) {
          testInfo.skip(true, "CLOUDSQL_USER/PASSWORD not set");
          return;
        }
        test.setTimeout(600_000);
        await runtimeHarness.configureCloudSqlInstance({
          instanceConnectionName: config.instanceConnectionName,
          user: cloudSqlUser,
          password: cloudSqlPassword,
        });
        expect(config.instanceConnectionName).toBeTruthy();
      });

      test("Verify successful DB connection", async ({ page }) => {
        await runtimeHarness.verifyGuestSession(page);
        const homePage = new HomePage(page);
        await homePage.verifyWelcomeHeading();
      });
    });
  }
});
