import { test } from "@playwright/test";
import { HomePage } from "../../support/pages/home-page";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { TechRadar } from "../../support/pages/tech-radar";

// Pre-req: Enable plugin-tech-radar and plugin-tech-radar-backend Plugin

test.describe("Test Customized Quick Access and tech-radar plugin", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test.beforeEach(async ({ page }) => {
    const common = new Common(page);
    await common.loginAsGuest();
  });

  test("Verify Customized Quick Access", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.verifyQuickAccess("MONITORING TOOLS", "Grafana", true);
    await homePage.verifyQuickAccess("SECURITY TOOLS", "Keycloak", true);
  });

  test("Verify tech-radar", async ({ page }) => {
    const uiHelper = new UIhelper(page);
    const techRadar = new TechRadar(page);

    await uiHelper.openSidebar("Tech Radar");
    await uiHelper.verifyHeading("Tech Radar");
    await uiHelper.verifyHeading("Company Radar");

    await techRadar.verifyRadarDetails("Languages", "JavaScript");
    // TODO: This is cluster-dependent and we need tests cluster-agnostic, remove if not needed
    // await techRadar.verifyRadarDetails("Storage", "AWS S3");
    await techRadar.verifyRadarDetails("Frameworks", "React");
    await techRadar.verifyRadarDetails("Infrastructure", "GitHub Actions");
  });
});
