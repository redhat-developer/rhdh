import { HomePage } from "../../support/pages/home-page";
import { TechRadar } from "../../support/pages/tech-radar";
import { guestTest } from "../../support/fixtures/guest-login";

// Pre-req: Enable plugin-tech-radar and plugin-tech-radar-backend Plugin

guestTest.describe("Test Customized Quick Access and tech-radar plugin", () => {
  guestTest("Verify Customized Quick Access", async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.verifyQuickAccess("MONITORING TOOLS", "Grafana", true);
    await homePage.verifyQuickAccess("SECURITY TOOLS", "Keycloak", true);
  });

  guestTest("Verify tech-radar", async ({ page, uiHelper }) => {
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
