import { test as base, expect } from "@playwright/test";
import { KubeClient } from "../../utils/kube-client";
import { OperatorScript } from "../../support/api/operator-script";
import { LOGGER } from "../../utils/logger";
import { Common } from "../../utils/common";
import { UiHelper } from "../../utils/ui-helper";

type OcFixture = {
  namespace: string;
  kube: KubeClient;
  common: Common;
  uiHelper: UiHelper;
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
  common: async ({ page }, use) => {
    use(new Common(page));
  },
  uiHelper: async ({ page }, use) => {
    use(new UiHelper(page));
  },
});

kubeTest.describe.serial("OpenShift Operator Tests", () => {
  kubeTest.slow();

  kubeTest(
    "Build OperatorScript",
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async ({ namespace, kube, page, common, uiHelper }) => {
      const operator = await OperatorScript.build(namespace);

      await operator.run(
        ["-v 1.3", "--install-operator rhdh", "--install-plan-approval Manual"],
        namespace,
      );
      await page.goto(operator.rhdhUrl);
      await common.loginAsGuest();
      await uiHelper.openSidebar("Settings");
      const version13 = await page
        .locator(`body`, { hasText: "RHDH Version: 1.3.0" })
        .isVisible();
      expect(version13);

      await operator.run(
        ["-v 1.4", "--install-operator rhdh", "--install-plan-approval Manual"],
        namespace,
      );

      await page.goto(operator.rhdhUrl);
      common.loginAsGuest();
      uiHelper.openSidebar("Settings");
      const version14 = await page
        .locator(`body`, { hasText: "RHDH Version: 1.4.0" })
        .isVisible();
      expect(version14);
    },
  );
});
