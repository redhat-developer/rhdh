import { test as base, expect } from "@playwright/test";
import { KubeClient } from "../utils/kube-client";
import { OperatorScript } from "../support/api/operator-script";
import { LOGGER } from "../utils/logger";

type OcFixture = {
  namespace: string;
  kube: KubeClient;
};

const kubeTest = base.extend<OcFixture>({
  // eslint-disable-next-line no-empty-pattern
  namespace: async ({}, use) => {
    LOGGER.info("starting fixture: namespace");
    const namespace = "deleteme" + Date.now().toString();
    use(namespace);
  },

  kube: async ({ namespace }, use) => {
    LOGGER.info("starting fixture: kube");
    const api = new KubeClient();
    await api.createNamespaceIfNotExists(namespace);
    await use(api);
    await api.deleteNamespaceAndWait(namespace);
  },
});

kubeTest.describe.only("OpenShift Operator Tests", () => {
  kubeTest.slow();
  kubeTest("Create namespace", async ({ namespace, kube }) => {
    expect(kube.checkNamespaceExists(namespace));
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  kubeTest("Build OperatorScript", async ({ namespace, kube, page }) => {
    const operator = await OperatorScript.build(
      namespace,
      "https://api.cluster-phwc2.phwc2.sandbox609.opentlc.com:6443",
      "admin",
      "sha256~SoAiuJFZE7Lj1npgSpI18PB9hXKGCFnvnMCbj_g16Uw",
    );
    await operator.run([
      "-v 1.4",
      "--install-operator rhdh",
      //"--install-plan-approval Automatic",
    ]);

    await page.goto(operator.rhdhUrl);
    const title = await page.title();
    expect(title).toContain("Red Hat Developer Hub");
  });
});
