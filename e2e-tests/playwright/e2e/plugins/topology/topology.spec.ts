import { test, expect } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UiHelper } from "../../../utils/ui-helper";
import { Catalog } from "../../../support/pages/catalog";
import { Topology } from "../../../support/pages/topology";

test.describe("Test Topology Plugin", () => {
  let common: Common;
  let uiHelper: UiHelper;
  let catalog: Catalog;
  let topology: Topology;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UiHelper(page);
    catalog = new Catalog(page);
    topology = new Topology(page);
    await common.loginAsGuest();
  });

  test("Verify pods visibility in the Topology tab", async ({ page }) => {
    await catalog.goToBackstageJanusProject();
    await uiHelper.clickTab("Topology");
    await uiHelper.verifyText("backstage-janus");
    await page.getByRole("button", { name: "Fit to Screen" }).click();
    await uiHelper.verifyText("topology-test");
    await uiHelper.verifyButtonURL("Open URL", "topology-test-route", {
      locator: `[data-test-id="topology-test"]`,
    });
    await page.locator("[data-test-id=topology-test] image").first().click();
    await page.getByLabel("Pod").click();
    await page.getByLabel("Pod").getByText("1", { exact: true }).click();
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
          .getByRole("link", { name: "topology-test-route" }),
      ).toBeVisible();
      await expect(page.locator("pre")).toBeVisible();
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
    await page.getByLabel("Display options").click();
    await page.getByLabel("Pod count").click();
    await uiHelper.verifyText("1");
    await uiHelper.verifyText("Pod");
    await topology.hoverOnPodStatusIndicator();
    await uiHelper.verifyTextInTooltip("Running");
    await uiHelper.verifyText("1Running");
    await uiHelper.verifyButtonURL(
      "Edit source code",
      "https://github.com/janus-idp/backstage-showcase",
    );
    await uiHelper.clickTab("Resources");
    await uiHelper.verifyText("P");
    expect(await page.getByTestId("icon-with-title-Running")).toBeVisible();
    expect(
      await page.getByTestId("icon-with-title-Running").locator("svg"),
    ).toBeVisible();
    expect(
      await page
        .getByTestId("icon-with-title-Running")
        .getByTestId("status-text"),
    ).toHaveText("Running");
    await uiHelper.verifyHeading("PipelineRuns");
    await uiHelper.verifyText("PL");
    await uiHelper.verifyText("PLR");
    await page.getByTestId("status-ok").first().click();
    await uiHelper.verifyDivHasText("Pipeline SucceededTask");
    await uiHelper.verifyText("Pipeline Succeeded");
  });
});
