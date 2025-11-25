import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { KubeClient } from "../../utils/kube-client";
import {
  getRdsDbCertificates,
  configurePostgresCertificate,
  configurePostgresCredentials,
} from "./db-certificates";

test.describe
  .serial("Verify TLS configuration with RDS PostgreSQL health check", () => {
  const namespace = process.env.NAME_SPACE_RUNTIME || "showcase-runtime";
  const job: string = process.env.JOB_NAME || "";
  let deploymentName = process.env.RELEASE_NAME + "-developer-hub";
  if (job.includes("operator")) {
    deploymentName = "backstage-" + process.env.RELEASE_NAME;
  }

  // RDS configuration from environment
  const rdsUser = process.env.RDS_USER;
  const rdsPassword = process.env.RDS_PASSWORD;
  const rdsHost1 = process.env.RDS_1_HOST;
  const rdsHost2 = process.env.RDS_2_HOST;
  const rdsHost3 = process.env.RDS_3_HOST;
  const rdsHost4 = process.env.RDS_4_HOST;

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

    // Skip if certificates not available
    const rdsCerts = getRdsDbCertificates();
    if (!rdsCerts) {
      console.log("RDS_DB_CERTIFICATES not set, skipping RDS configuration");
      return;
    }

    const kubeClient = new KubeClient();

    // Create/update the postgres-crt secret with RDS certificates
    console.log("Configuring RDS TLS certificates...");
    await configurePostgresCertificate(kubeClient, namespace, rdsCerts);

    // Create/update the postgres-cred secret with RDS credentials
    console.log("Configuring RDS credentials for latest-3 version...");
    await configurePostgresCredentials(kubeClient, namespace, {
      host: rdsHost1,
      user: rdsUser,
      password: rdsPassword,
    });

    console.log("Restarting deployment to apply RDS configuration...");
    await kubeClient.restartDeployment(deploymentName, namespace);
  });

  test("Verify successful DB connection with RDS latest-3 PostgreSQL version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test("Change the config to use the RDS latest-2 PostgreSQL version", async () => {
    const kubeClient = new KubeClient();
    test.setTimeout(270000);
    await configurePostgresCredentials(kubeClient, namespace, {
      host: rdsHost2,
    });
    await kubeClient.restartDeployment(deploymentName, namespace);
  });

  test("Verify successful DB connection with RDS latest-2 PostgreSQL version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test("Change the config to use the RDS latest-1 PostgreSQL version", async () => {
    const kubeClient = new KubeClient();
    test.setTimeout(270000);
    await configurePostgresCredentials(kubeClient, namespace, {
      host: rdsHost3,
    });
    await kubeClient.restartDeployment(deploymentName, namespace);
  });

  test("Verify successful DB connection with RDS latest-1 PostgreSQL version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test("Change the config to use the RDS latest PostgreSQL version", async () => {
    const kubeClient = new KubeClient();
    test.setTimeout(270000);
    await configurePostgresCredentials(kubeClient, namespace, {
      host: rdsHost4,
    });
    await kubeClient.restartDeployment(deploymentName, namespace);
  });

  test("Verify successful DB connection with RDS latest PostgreSQL version", async ({
    page,
  }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });
});
