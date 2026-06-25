import { expect, test } from "@support/coverage/test";

import { signInAsGuest } from "../../support/auth/guest-auth";
import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";
import { clearDatabase, readCertificateFile } from "../../utils/postgres-config";

interface RdsConfig {
  name: string;
  host: string;
}

test.describe("Verify TLS configuration with RDS PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME! || "showcase-runtime";
  const runtimeHarness = new RuntimeHarness(namespace);

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
    const rdsCerts = readCertificateFile(process.env.RDS_DB_CERTIFICATES_PATH);
    if (rdsCerts === undefined || rdsCerts === null || rdsCerts === "") {
      throw new Error(
        "RDS_DB_CERTIFICATES_PATH environment variable must be set and point to a valid certificate file",
      );
    }

    // Validate required environment variables
    if (!rdsUser || !rdsPassword) {
      throw new Error("RDS_USER and RDS_PASSWORD environment variables must be set");
    }

    // Create/update the postgres-crt secret with RDS certificates
    console.log("Configuring RDS TLS certificates...");
    await runtimeHarness.configurePostgresCertificate(rdsCerts);
  });

  for (const config of rdsConfigurations) {
    test.describe.serial(`RDS ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async () => {
        test.info().annotations.push({
          type: "database",
          description: config.host?.split(".")[0] || "unknown",
        });
        await clearDatabase({
          host: config.host,
          user: rdsUser,
          password: rdsPassword,
          certificatePath: process.env.RDS_DB_CERTIFICATES_PATH!,
        });
      });

      test("Configure and restart deployment", async () => {
        await runtimeHarness.configureExternalPostgres({
          credentials: {
            host: config.host,
            user: rdsUser,
            password: rdsPassword,
          },
        });
        expect(config.host).toBeTruthy();
      });

      test("Verify successful DB connection", async ({ page }) => {
        const homePage = new HomePage(page);
        await signInAsGuest(page);
        await homePage.verifyWelcomeHeading();
      });
    });
  }
});
