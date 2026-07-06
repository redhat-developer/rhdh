import { expect, test } from "@support/coverage/test";

import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";
import { clearDatabase, readCertificateFile } from "../../utils/postgres-config";

interface AzureDbConfig {
  name: string;
  host: string;
}

test.describe("Verify TLS configuration with Azure Database for PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME! || "showcase-runtime";
  const runtimeHarness = new RuntimeHarness(namespace);

  // Azure DB configuration from environment
  const azureUser = process.env.AZURE_DB_USER!;
  const azurePassword = process.env.AZURE_DB_PASSWORD!;

  // Define all Azure DB configurations to test
  const azureConfigurations: AzureDbConfig[] = [
    { name: "latest-3", host: process.env.AZURE_DB_1_HOST! },
    { name: "latest-2", host: process.env.AZURE_DB_2_HOST! },
    { name: "latest-1", host: process.env.AZURE_DB_3_HOST! },
    { name: "latest", host: process.env.AZURE_DB_4_HOST! },
  ];

  test.beforeAll(async () => {
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

    // Validate certificates are available
    const azureCerts = readCertificateFile(process.env.AZURE_DB_CERTIFICATES_PATH);
    if (azureCerts === undefined || azureCerts === null || azureCerts === "") {
      throw new Error(
        "AZURE_DB_CERTIFICATES_PATH environment variable must be set and point to a valid certificate file",
      );
    }

    // Validate required environment variables
    if (!azureUser || !azurePassword) {
      throw new Error("AZURE_DB_USER and AZURE_DB_PASSWORD environment variables must be set");
    }

    // Create/update the postgres-crt secret with Azure certificates
    console.log("Configuring Azure Database for PostgreSQL TLS certificates...");
    await runtimeHarness.configurePostgresCertificate(azureCerts);
  });

  for (const config of azureConfigurations) {
    test.describe.serial(`Azure DB ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async () => {
        test.info().annotations.push({
          type: "database",
          description: config.host?.split(".")[0] || "unknown",
        });
        await clearDatabase({
          host: config.host,
          user: azureUser,
          password: azurePassword,
          certificatePath: process.env.AZURE_DB_CERTIFICATES_PATH!,
        });
      });

      test("Configure and restart deployment", async () => {
        await runtimeHarness.configureExternalPostgres({
          credentials: {
            host: config.host,
            user: azureUser,
            password: azurePassword,
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
