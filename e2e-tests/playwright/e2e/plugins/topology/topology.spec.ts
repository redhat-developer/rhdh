import { expect } from "@playwright/test";
import { Catalog } from "../../../support/pages/catalog";
import { Topology } from "../../../support/pages/topology";
import { guestTest } from "../../../support/fixtures/guest-login";

guestTest.describe("Test Topology Plugin", () => {
  let catalog: Catalog;
  let topology: Topology;

  guestTest.beforeEach(async ({ page }) => {
    catalog = new Catalog(page);
    topology = new Topology(page);
  });

  guestTest(
    "Verify pods visibility in the Topology tab",
    async ({ page, uiHelper }, testInfo) => {
      // progressively increase test timeout for retries
      guestTest.setTimeout(150000 + testInfo.retry * 30000);
      await catalog.goToBackstageJanusProject();
      await uiHelper.clickTab("Topology");
      await uiHelper.verifyText("backstage-janus");
      await page.getByRole("button", { name: "Fit to Screen" }).click();
      await topology.verifyDeployment("topology-test");
      await uiHelper.verifyButtonURL("Open URL", "topology-test-route", {
        locator: `[data-test-id="topology-test"]`,
      });
      await uiHelper.clickTab("Details");
      await uiHelper.verifyText("Status");
      await uiHelper.verifyText("Active");
      await uiHelper.clickTab("Resources");
      await uiHelper.verifyHeading("Pods");
      await uiHelper.verifyHeading("Services");
      if (await page.getByText("Ingresses").isVisible()) {
        await uiHelper.verifyHeading("Ingresses");
        await uiHelper.verifyText("I");
        await expect(
          page
            .getByTestId("ingress-list")
            .getByRole("link", { name: "topology-test-route" })
            .first(),
        ).toBeVisible();
        await expect(page.locator("pre").first()).toBeVisible();
      } else {
        await uiHelper.verifyHeading("Routes");
        await uiHelper.verifyText("RT");
        await expect(
          page.getByRole("link", { name: "topology-test-route" }).first(),
        ).toBeVisible();
      }
      await uiHelper.verifyText("Location:");
      await expect(page.getByTitle("Deployment")).toBeVisible();
      await uiHelper.verifyText("S");
      await expect(page.locator("rect").first()).toBeVisible();
      await uiHelper.clickTab("Details");
      await page.getByLabel("Pod").hover();
      await page.getByText("Display options").click();
      await page.getByLabel("Pod count").click();
      await uiHelper.verifyText("1");
      await uiHelper.verifyText("Pod");
      // await topology.hoverOnPodStatusIndicator();
      // await uiHelper.verifyTextInTooltip("Running");
      // await uiHelper.verifyText("1Running");
      await uiHelper.verifyButtonURL(
        "Edit source code",
        "https://github.com/janus-idp/backstage-showcase",
      );
      await uiHelper.clickTab("Resources");
      await uiHelper.verifyText("P");
      await expect(page.getByTestId("icon-with-title-Running")).toBeVisible();
      await expect(
        page.getByTestId("icon-with-title-Running").locator("svg"),
      ).toBeVisible();
      await expect(
        page.getByTestId("icon-with-title-Running").getByTestId("status-text"),
      ).toHaveText("Running");
      await uiHelper.verifyHeading("PipelineRuns");
      await uiHelper.verifyText("PL");
      await uiHelper.verifyText("PLR");
      await page.getByTestId("status-ok").first().click();
      await uiHelper.verifyDivHasText("Pipeline SucceededTask");
      await uiHelper.verifyText("Pipeline Succeeded");
    },
  );
});
