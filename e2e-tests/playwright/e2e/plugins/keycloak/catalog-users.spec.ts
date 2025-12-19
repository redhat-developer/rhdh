import { CatalogUsersPO } from "../../../support/page-objects/catalog/catalog-users-obj";
import Keycloak from "../../../utils/keycloak/keycloak";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { test, expect } from "@playwright/test";
import { ChildProcessWithoutNullStreams, spawn, exec } from "child_process";
import { KubeClient } from "../../../utils/kube-client";

test.describe("Test Keycloak plugin", () => {
  let uiHelper: UIhelper;
  let keycloak: Keycloak;
  let common: Common;
  let token: string;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });

    keycloak = new Keycloak();
    token = await keycloak.getAuthenticationToken();
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsGuest();
    await CatalogUsersPO.visitBaseURL(page);
  });

  test("Users on keycloak should match users on backstage", async ({
    page,
  }) => {
    const keycloakUsers = await keycloak.getUsers(token);
    const backStageUsersLocator = await CatalogUsersPO.getListOfUsers(page);
    await backStageUsersLocator.first().waitFor({ state: "visible" });
    const backStageUsersCount = await backStageUsersLocator.count();

    expect(keycloakUsers.length).toBeGreaterThan(0);
    expect(backStageUsersCount).toBeGreaterThan(0);

    for (let i = 0; i < backStageUsersCount; i++) {
      const backStageUser = backStageUsersLocator.nth(i);
      const backStageUserText = await backStageUser.textContent();
      const userFound = keycloakUsers.find(
        (user) => user.username === backStageUserText,
      );
      expect(userFound).not.toBeNull();

      // eslint-disable-next-line playwright/no-conditional-in-test
      if (userFound) {
        await keycloak.checkUserDetails(
          page,
          userFound,
          token,
          uiHelper,
          keycloak,
        );
      }
    }
  });
});

test.describe("Test Keycloak plugin metrics", () => {
  let portForward: ChildProcessWithoutNullStreams;

  test.beforeEach(async () => {
    const namespace = process.env.NAME_SPACE || "showcase-ci-nightly";
    const kubeClient = new KubeClient();

    console.log("Starting port-forward process...");

    const services = await kubeClient.getServiceByLabel(
      namespace,
      "app.kubernetes.io/instance=rhdh",
    );
    const rhdhMetricsServiceName = services.find((service) =>
      service.spec?.ports.some((p) => p.port === 9464),
    );
    portForward = spawn("/bin/sh", [
      "-c",
      `
      oc login --token="${process.env.K8S_CLUSTER_TOKEN}" --server="${process.env.K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true &&
      kubectl config set-context --current --namespace="${namespace}" &&
      kubectl port-forward service/${rhdhMetricsServiceName.metadata?.name} 9464:9464 --namespace="${namespace}"
    `,
    ]);

    console.log("Waiting for port-forward to be ready...");
    await new Promise<void>((resolve, reject) => {
      portForward.stdout.on("data", (data) => {
        if (data.toString().includes("Forwarding from 127.0.0.1:9464")) {
          resolve();
        }
      });

      portForward.stderr.on("data", (data) => {
        console.error(`Port forwarding failed: ${data.toString()}`);
        reject(new Error(`Port forwarding failed: ${data.toString()}`));
      });
    });
  });

  test.afterEach(() => {
    console.log("Killing port-forward process with ID:", portForward.pid);
    portForward.kill("SIGKILL");
    console.log("Killing remaining port-forward process.");
    exec(
      `ps aux | grep 'kubectl port-forward' | grep -v grep | awk '{print $2}' | xargs kill -9`,
    );
  });

  test("Test keycloak metrics with failure counters", async () => {
    const metricsEndpointURL = "http://localhost:9464/metrics";
    const metricLines = await fetchMetrics(metricsEndpointURL);

    const metricLineStartWith =
      'backend_keycloak_fetch_task_failure_count_total{taskInstanceId="';
    const metricLineEndsWith = '"} 1';
    const isContainMetricFailureCounter = metricLines.find(
      (line) =>
        line.startsWith(metricLineStartWith) &&
        line.endsWith(metricLineEndsWith),
    );
    expect(isContainMetricFailureCounter).toBeTruthy();
  });
});

async function fetchMetrics(metricsEndpoitUrl: string): Promise<string[]> {
  const response = await fetch(metricsEndpoitUrl, {
    method: "GET",
    headers: { "Content-Type": "plain/text" },
  });

  if (response.status !== 200)
    throw new Error("Failed to retrieve metrics from RHDH");
  const data = await response.text();

  return data.split("\n");
}
