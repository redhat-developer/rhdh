import { CatalogUsersPO } from "../../../support/pageObjects/catalog/catalog-users-obj";
import Keycloak from "../../../utils/keycloak/keycloak";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { test, expect } from "@playwright/test";
import { KubeClient } from "../../../utils/kube-client";

test.describe("Test Keycloak plugin", () => {
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
  const namespace = process.env.NAME_SPACE || "showcase-ci-nightly";
  const baseRHDHURL: string = process.env.BASE_URL;
  console.log(`strange ${baseRHDHURL}`);
  let kubeClient: KubeClient;
  const routerName = "rhdh-metrics";

  test.beforeEach(() => {
    kubeClient = new KubeClient();
    console.log(
      `Running test in namespace: ${namespace} with router name: ${routerName}`,
    );
  });

  test.afterAll(async () => {
    if (process.env.IS_OPENSHIFT === "true") {
      await cleanUpRouter(kubeClient, namespace, routerName);
    } else {
      await cleanUpIngress(kubeClient, namespace, routerName);
    }
  });

  test("Test keycloak metrics with failure counters", async () => {
    const host: string = new URL(baseRHDHURL).hostname;
    const domain = host.split(".").slice(1).join(".");

    if (process.env.IS_OPENSHIFT === "true") {
      await createRouteIfNotPresentAndWait(
        kubeClient,
        namespace,
        routerName,
        domain,
      );
    } else {
      const pods = await kubeClient.getPodList(namespace);
      if (pods?.body?.items) {
        pods.body.items.forEach((pod, index) => {
          console.log(`--- Pod ${index + 1} ---`);
          console.log(JSON.stringify(pod, null, 2));
        });
      }

      await createIngressIfNotPresentAndWait(
        kubeClient,
        namespace,
        routerName,
        domain,
      );

      const ingresses = await kubeClient.getIngresses(namespace);
      if (!ingresses || !Array.isArray(ingresses.items)) {
        console.log(`No ingresses found in namespace "${namespace}".`);
        return;
      }

      for (const ingress of ingresses.items) {
        const name = ingress.metadata?.name ?? "<no-name>";
        const rules = ingress.spec?.rules ?? [];

        if (rules.length === 0) {
          console.log(`Ingress "${name}" has no rules.`);
          continue;
        }

        for (const rule of rules) {
          const host = rule.host ?? "<no-host>";
          const paths = rule.http?.paths ?? [];

          for (const path of paths) {
            const pathStr = path.path ?? "/";
            const url = `http://${host}${pathStr}`;
            console.log(`Ingress: ${name} → ${url}`);
          }
        }
      }
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

async function createRouteIfNotPresentAndWait(
  kubeClient: KubeClient,
  namespace: string,
  routerName: string,
  domain: string,
) {
  const metricsRoute = await kubeClient.getRoute(namespace, routerName);
  if (!metricsRoute) {
    const service = await kubeClient.getServiceByLabel(
      namespace,
      "backstage.io/kubernetes-id=developer-hub",
    );

    console.log(`===== Print service start:`);
    console.log(JSON.stringify(service, null, 2));
    console.log(`===== Print service end:`);

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
}

async function createIngressIfNotPresentAndWait(
  kubeClient: KubeClient,
  namespace: string,
  ingressName: string,
  domain: string,
) {
  const metricsIngress = await kubeClient.getIngress(namespace, ingressName);
  if (!metricsIngress) {
    const service = await kubeClient.getServiceByLabel(
      namespace,
      "backstage.io/kubernetes-id=developer-hub",
    );
    const rhdhServiceName = service[0].metadata.name;
    const ingress = {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: ingressName,
        namespace,
        annotations: {
          "nginx.ingress.kubernetes.io/rewrite-target": "/metrics",
        },
      },
      spec: {
        rules: [
          {
            host: `${ingressName}.${domain}`,
            http: {
              paths: [
                {
                  path: "/metrics",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: rhdhServiceName,
                      port: {
                        number: 9464,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    await kubeClient.createIngress(namespace, ingress);
  }

  // Wait until the ingress is available.
  await new Promise((resolve) => setTimeout(resolve, 10000));
}

async function cleanUpRouter(
  kubeClient: KubeClient,
  namespace: string,
  routerName: string,
) {
  const metricsRoute = await kubeClient.getRoute(namespace, routerName);
  if (metricsRoute) {
    await kubeClient.deleteRoute(namespace, routerName);
  }
}

async function cleanUpIngress(
  kubeClient: KubeClient,
  namespace: string,
  ingressName: string,
) {
  const metricsIngress = await kubeClient.getIngress(namespace, ingressName);
  if (metricsIngress) {
    await kubeClient.deleteIngress(namespace, ingressName);
  }
}

async function fetchMetrics(metricsEndpoitUrl: string): Promise<string[]> {
  const response = await fetch(metricsEndpoitUrl, {
    method: "GET",
    headers: { "Content-Type": "plain/text" },
  });

  if (response.status !== 200)
    throw new Error("Failed to retrieve metrics from RHDH");
  const data = await response.text();

  console.log(data);
  return data.split("\n");
}
