import { test, expect } from "@support/coverage/test";

import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";
import { clearDatabase, readCertificateFile } from "../../utils/postgres-config";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";

interface RdsConfig {
  name: string;
  host: string | undefined;
}

test.describe("Verify TLS configuration with RDS PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
  const runtimeHarness = new RuntimeHarness(namespace);

  const rdsUser = process.env.RDS_USER;
  const rdsPassword = process.env.RDS_PASSWORD;

  const rdsConfigurations: RdsConfig[] = [
    { name: "latest-3", host: process.env.RDS_1_HOST },
    { name: "latest-2", host: process.env.RDS_2_HOST },
    { name: "latest-1", host: process.env.RDS_3_HOST },
    { name: "latest", host: process.env.RDS_4_HOST },
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

    const rdsCerts = readCertificateFile(process.env.RDS_DB_CERTIFICATES_PATH);
    if (
      rdsCerts === null ||
      rdsUser === undefined ||
      rdsUser === "" ||
      rdsPassword === undefined ||
      rdsPassword === ""
    ) {
      testInfo.skip(
        true,
        "RDS environment variables not configured (RDS_DB_CERTIFICATES_PATH, RDS_USER, RDS_PASSWORD) — RDS tests are opt-in",
      );
      return;
    }

    await runtimeHarness.prepareForExternalDatabase();
    console.log("Configuring RDS TLS certificates...");
    await runtimeHarness.configurePostgresCertificate(rdsCerts);
  });

  for (const config of rdsConfigurations) {
    test.describe.serial(`RDS ${config.name} PostgreSQL version`, () => {
      test.beforeAll(async ({}, testInfo) => {
        test.setTimeout(135_000);
        if (config.host === undefined || config.host === "") {
          testInfo.skip(true, `RDS_*_HOST not set for ${config.name} — skipping`);
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
        if (config.host === undefined || config.host === "") {
          testInfo.skip(true, `RDS_*_HOST not set for ${config.name}`);
          return;
        }
        test.setTimeout(600_000);
        await runtimeHarness.configureExternalPostgres({
          credentials: {
            host: config.host,
            user: rdsUser!,
            password: rdsPassword!,
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
