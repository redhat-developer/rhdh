import { test } from "@playwright/test";
import { Common } from "../utils/common";
import { KubeClient } from "../utils/kube-client";

test.describe
  .serial("Verify TLS configuration with Postgres DB health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const deploymentName = "rhdh-backstage";
  const secretName = "postgres-cred";
  const hostLatest2 = Buffer.from(process.env.RDS_2_HOST).toString("base64");
  const hostLatest3 = Buffer.from(process.env.RDS_3_HOST).toString("base64");

  test("Verify successful DB connection and successful initialization of plugins with latest-1 postgres version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test("Change the config to use the latest-2 postgres version", async () => {
    const kubeCLient = new KubeClient();
    test.setTimeout(120000);
    const secretData = {
      POSTGRES_HOST: hostLatest2,
    };
    const patch = {
      data: secretData,
    };
    await kubeCLient.updateSecret(secretName, namespace, patch);
    await kubeCLient.restartDeployment(deploymentName, namespace);
  });

  test("Verify successful DB connection and successful initialization of plugins with latest-2 postgres version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test("Change the config to use the latest-3 postgres version", async () => {
    const kubeCLient = new KubeClient();
    test.setTimeout(120000);
    const secretData = {
      POSTGRES_HOST: hostLatest3,
    };
    const patch = {
      data: secretData,
    };
    await kubeCLient.updateSecret(secretName, namespace, patch);
    await kubeCLient.restartDeployment(deploymentName, namespace);
  });

  test("Verify successful DB connection and successful initialization of plugins with latest-3 postgres version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });
});
