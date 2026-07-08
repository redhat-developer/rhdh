import { test, expect } from "@support/coverage/test";

import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";
import { clearDatabase, readCertificateFile } from "../../utils/postgres-config";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";

interface AzureDbConfig {
  name: string;
  host: string | undefined;
}

test.describe("Verify TLS configuration with Azure Database for PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const runtimeHarness = new RuntimeHarness(namespace);

  const azureUser = process.env.AZURE_DB_USER;
  const azurePassword = process.env.AZURE_DB_PASSWORD;

  const azureConfigurations: AzureDbConfig[] = [
    { name: "latest-3", host: process.env.AZURE_DB_1_HOST },
    { name: "latest-2", host: process.env.AZURE_DB_2_HOST },
    { name: "latest-1", host: process.env.AZURE_DB_3_HOST },
    { name: "latest", host: process.env.AZURE_DB_4_HOST },
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

    const azureCerts = readCertificateFile(process.env.AZURE_DB_CERTIFICATES_PATH);
    if (
      azureCerts === null ||
      azureUser === undefined ||
      azureUser === "" ||
      azurePassword === undefined ||
      azurePassword === ""
    ) {
      testInfo.skip(
        true,
        "Azure DB environment variables not configured (AZURE_DB_CERTIFICATES_PATH, AZURE_DB_USER, AZURE_DB_PASSWORD) — Azure DB tests are opt-in",
      );
      return;
    }

    await runtimeHarness.prepareForExternalDatabase();
    console.log("Configuring Azure Database for PostgreSQL TLS certificates...");
    await runtimeHarness.configurePostgresCertificate(azureCerts);
  });

  for (const config of azureConfigurations) {
    test.describe.serial(`Azure DB ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async ({}, testInfo) => {
        test.setTimeout(180_000);
        if (config.host === undefined || config.host === "") {
          testInfo.skip(true, `AZURE_DB_*_HOST not set for ${config.name} — skipping`);
          return;
        }
        test.info().annotations.push({
          type: "database",
          description: config.host.split(".")[0] || "unknown",
        });
        await clearDatabase({
          host: config.host,
          user: azureUser!,
          password: azurePassword!,
          certificatePath: process.env.AZURE_DB_CERTIFICATES_PATH,
        });
      });

      test("Configure and restart deployment", async ({}, testInfo) => {
        if (config.host === undefined || config.host === "") {
          testInfo.skip(true, `AZURE_DB_*_HOST not set for ${config.name}`);
          return;
        }
        test.setTimeout(600_000);
        await runtimeHarness.configureExternalPostgres({
          credentials: {
            host: config.host,
            user: azureUser!,
            password: azurePassword!,
          },
        });
        expect(config.host).toBeTruthy();
      });

      test("Verify successful DB connection", async ({ page }) => {
        await runtimeHarness.verifyGuestSession(page);
        const homePage = new HomePage(page);
        await homePage.verifyWelcomeHeading();
      });
    });
  }
});
