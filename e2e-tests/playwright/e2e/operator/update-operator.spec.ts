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
  kubeTest.setTimeout(1_000_000);

  kubeTest(
    "Build OperatorScript",
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async ({ namespace, kube, page, common, uiHelper }) => {
      const oldVersion = "1.4";
      const newVersion = "1.5";
      const operator = await OperatorScript.build(namespace);

      await operator.run(
        [
          `-v ${oldVersion}`,
          "--install-operator rhdh",
          "--install-plan-approval Manual",
        ],
        namespace,
      );

      LOGGER.info("rhdhUrl: " + operator.rhdhUrl);
      await page.waitForTimeout(300_000);
      await common.loginAsGuest(operator.rhdhUrl);
      await uiHelper.openSidebar("Settings");
      const version13 = await page
        .locator(`body`, { hasText: `RHDH Version: ${oldVersion}.0` })
        .isVisible();
      expect(version13);

      await operator.run(
        [
          `-v ${newVersion}`,
          "--install-operator rhdh",
          "--install-plan-approval Manual",
        ],
        namespace,
      );
      await page.waitForTimeout(300_000);

      await common.loginAsGuest(operator.rhdhUrl);
      await uiHelper.openSidebar("Settings");
      const version14 = await page
        .locator(`body`, { hasText: `RHDH Version: ${newVersion}.0` })
        .isVisible();
      expect(version14);
    },
  );
});
