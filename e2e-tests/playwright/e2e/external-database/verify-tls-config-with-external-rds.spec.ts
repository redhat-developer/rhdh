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
import { UIhelper } from "../../utils/ui-helper";

interface RdsConfig {
  name: string;
  host: string;
}

test.describe("Verify TLS configuration with RDS PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME! || "showcase-runtime";
  const deploymentName = getRhdhDeploymentName();

  // RDS configuration from environment
  const rdsUser = process.env.RDS_USER!;
  const rdsPassword = process.env.RDS_PASSWORD!;

  // Define all RDS configurations to test
  const rdsConfigurations: RdsConfig[] = [
    { name: "latest-3", host: process.env.RDS_1_HOST! },
    { name: "latest-2", host: process.env.RDS_2_HOST! },
    { name: "latest-1", host: process.env.RDS_3_HOST! },
    { name: "latest", host: process.env.RDS_4_HOST! },
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

    // Validate certificates are available — skip gracefully if not set
    const rdsCerts = readCertificateFile(process.env.RDS_DB_CERTIFICATES_PATH);
    if (!rdsCerts || !rdsUser || !rdsPassword) {
      testInfo.skip(
        true,
        "RDS environment variables not configured (RDS_DB_CERTIFICATES_PATH, RDS_USER, RDS_PASSWORD) — RDS tests are opt-in",
      );
      return;
    }

    const kubeClient = new KubeClient();

    // Prepare the deployment for external database tests: patch the app-config
    // to use env var placeholders and clean up any schema-mode env var patches
    await prepareForExternalDatabase(kubeClient, namespace, deploymentName);

    // Create/update the postgres-crt secret with RDS certificates
    console.log("Configuring RDS TLS certificates...");
    await configurePostgresCertificate(kubeClient, namespace, rdsCerts);
  });

  for (const config of rdsConfigurations) {
    test.describe.serial(`RDS ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async ({}, testInfo) => {
        test.setTimeout(135000);
        if (!config.host) {
          testInfo.skip(
            true,
            `RDS_*_HOST not set for ${config.name} — skipping`,
          );
          return;
        }
        test.info().annotations.push({
          type: "database",
          description: config.host.split(".")[0] || "unknown",
        });
        await clearDatabase({
          host: config.host,
          user: rdsUser!,
          password: rdsPassword!,
          certificatePath: process.env.RDS_DB_CERTIFICATES_PATH,
        });
      });

      test("Configure and restart deployment", async ({}, testInfo) => {
        if (!config.host) {
          testInfo.skip(true, `RDS_*_HOST not set for ${config.name}`);
          return;
        }
        const kubeClient = new KubeClient();
        test.setTimeout(600000);
        await configurePostgresCredentials(kubeClient, namespace, {
          host: config.host,
          user: rdsUser!,
          password: rdsPassword!,
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
