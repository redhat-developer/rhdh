import { CatalogUsersPO } from "../../../support/pageObjects/catalog/catalog-users-obj";
import Keycloak from "../../../utils/keycloak/keycloak";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { test, expect } from "@playwright/test";
import { KubeClient } from "../../../utils/kube-client";

test.describe.skip("Test Keycloak plugin", () => {
  // Skipping this test due to https://issues.redhat.com/browse/RHIDP-6844
  let uiHelper: UIhelper;
  let keycloak: Keycloak;
  let common: Common;
  let token: string;

  test.beforeAll(async () => {
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
  test.fixme(
    process.env.IS_OPENSHIFT === "false",
    "Failing on Kubernetes clusters, need to add Ingress, fix https://issues.redhat.com/browse/RHIDP-7531",
  );
  const namespace = process.env.NAME_SPACE || "showcase-ci-nightly";
  const baseRHDHURL: string = process.env.BASE_URL;
  let kubeClient: KubeClient;
  const routerName = "rhdh-metrics";

  test.beforeEach(() => {
    kubeClient = new KubeClient();
  });

  test.afterAll(async () => {
    const metricsRoute = await kubeClient.getRoute(namespace, routerName);
    if (metricsRoute) {
      await kubeClient.deleteRoute(namespace, routerName);
    }
  });

  test("Test keycloak metrics with failure counters", async () => {
    const host: string = new URL(baseRHDHURL).hostname;
    const domain = host.split(".").slice(1).join(".");

    const metricsRoute = await kubeClient.getRoute(namespace, routerName);
    if (!metricsRoute) {
      const service = await kubeClient.getServiceByLabel(
        namespace,
        "app.kubernetes.io/name=backstage",
      );
      const rhdhServiceName = service[0].metadata.name;
      const route = {
        apiVersion: "route.openshift.io/v1",
        kind: "Route",
        metadata: { name: routerName, namespace },
        spec: {
          host: `${routerName}.${domain}`,
          to: { kind: "Service", name: rhdhServiceName },
          port: { targetPort: "http-metrics" },
        },
      };
      await kubeClient.createRoute(namespace, route);
      // Wait until the route is available.
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    const metricsEndpointURL = `http://${routerName}.${domain}/metrics`;
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
