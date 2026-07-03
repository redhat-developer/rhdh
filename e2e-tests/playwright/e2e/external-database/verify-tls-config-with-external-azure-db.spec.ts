import { test } from "@support/coverage/test";

import { Common } from "../../utils/common";
import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import {
  readCertificateFile,
  configurePostgresCertificate,
  configurePostgresCredentials,
  clearDatabase,
  prepareForExternalDatabase,
} from "../../utils/postgres-config";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";
import { UIhelper } from "../../utils/ui-helper";

interface AzureDbConfig {
  name: string;
  host: string;
}

test.describe("Verify TLS configuration with Azure Database for PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME! || "showcase-runtime";
  const deploymentName = getRhdhDeploymentName();

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

    // Ensure the runtime RHDH instance is deployed (idempotent — no-op if already running)
    await ensureRuntimeDeployed();

    // Validate certificates are available — skip gracefully if not set
    const azureCerts = readCertificateFile(process.env.AZURE_DB_CERTIFICATES_PATH);
    if (azureCerts === null || azureCerts === undefined || !azureUser || !azurePassword) {
      testInfo.skip(
        true,
        "Azure DB environment variables not configured (AZURE_DB_CERTIFICATES_PATH, AZURE_DB_USER, AZURE_DB_PASSWORD) — Azure DB tests are opt-in",
      );
      return;
    }

    const kubeClient = new KubeClient();

    // Prepare the deployment for external database tests: patch the app-config
    // to use env var placeholders and clean up any schema-mode env var patches
    await prepareForExternalDatabase(kubeClient, namespace, deploymentName);

    // Create/update the postgres-crt secret with Azure certificates
    console.log("Configuring Azure Database for PostgreSQL TLS certificates...");
    await configurePostgresCertificate(kubeClient, namespace, azureCerts);
  });

  for (const config of azureConfigurations) {
    test.describe.serial(`Azure DB ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async ({}, testInfo) => {
        test.setTimeout(180000);
        if (!config.host) {
          testInfo.skip(true, `AZURE_DB_*_HOST not set for ${config.name} — skipping`);
          return;
        }
        test.info().annotations.push({
          type: "database",
          description: config.host.split(".")[0] || "unknown",
        });
        await clearDatabase({
          host: config.host,
          user: azureUser,
          password: azurePassword,
          certificatePath: process.env.AZURE_DB_CERTIFICATES_PATH,
        });
      });

      // Drop RHDH SSE connection so Playwright trace teardown doesn't hang
      // (microsoft/playwright#41513, fixed in v1.62).
      test.afterEach(async ({ page }) => {
        await page.goto("about:blank").catch(() => {});
      });

      test("Configure and restart deployment", async ({}, testInfo) => {
        if (!config.host) {
          testInfo.skip(true, `AZURE_DB_*_HOST not set for ${config.name}`);
          return;
        }
        const kubeClient = new KubeClient();
        test.setTimeout(600000);
        await configurePostgresCredentials(kubeClient, namespace, {
          host: config.host,
          user: azureUser,
          password: azurePassword,
        });
        await kubeClient.restartDeployment(deploymentName, namespace);
      });

      test("Verify successful DB connection", async ({ page }) => {
        const uiHelper = new UIhelper(page);
        const common = new Common(page);
        await common.loginAsGuest();
        await uiHelper.verifyHeading("Welcome back!");
      });
    });
  }
});
