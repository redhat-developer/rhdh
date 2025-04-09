import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { Extensions } from "../support/pages/extensions";

test.describe("Admin > Extensions > Catalog", () => {
  let extensions: Extensions;
  let uiHelper: UIhelper;
  const isMac = process.platform === "darwin";

  test.beforeEach(async ({ page }) => {
    extensions = new Extensions(page);
    uiHelper = new UIhelper(page);
    await new Common(page).loginAsKeycloakUser();
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Extensions");
    await uiHelper.verifyHeading("Extensions");
  });

  test("Verify search bar in extensions", async ({ page }) => {
    await uiHelper.searchInputPlaceholder("Dynatrace");
    await uiHelper.verifyHeading("DynaTrace");
    await page.getByRole("button", { name: "Clear Search" }).click();
  });

  test("Verify filters in extensions", async ({ page }) => {
    await uiHelper.clickTab("Catalog");
    await uiHelper.clickButton("CI/CD");
    await extensions.selectDropdown("Category");
    await page
      .getByRole("option", { name: "CI/CD" })
      .getByRole("checkbox")
      .isChecked();
    await extensions.clickAway();
    await extensions.selectDropdown("Author");
    await extensions.toggleOption("Red Hat");
    await extensions.clickAway();
    await uiHelper.verifyHeading("Red Hat Argo CD");
    await uiHelper.verifyText("by Red Hat");
    await page.getByRole("heading", { name: "Red Hat Argo CD" }).click();
    await uiHelper.verifyTableHeadingAndRows([
      "Package name",
      "Version",
      "Role",
      "Supported version",
      "Status",
    ]);
    await uiHelper.verifyHeading("Versions");
    await page.getByRole("button", { name: "close" }).click();
    await uiHelper.clickLink("Read more");
    await page.getByRole("button", { name: "close" }).click();
    await extensions.selectDropdown("Author");
    await extensions.toggleOption("Red Hat");
    await extensions.clickAway();
    await extensions.selectDropdown("Category");
    await extensions.toggleOption("CI/CD");
    await extensions.clickAway();
  });

  test("Verify certified badge in extensions", async ({ page }) => {
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Certified by Red Hat");
    await extensions.clickAway();
    await uiHelper.verifyHeading("DynaTrace");
    await expect(page.getByLabel("Certified by Red Hat").first()).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip("Certified by Red Hat");
    await uiHelper.verifyHeading("DynaTrace");
    await page.getByRole("heading", { name: "DynaTrace" }).first().click();
    await page.getByRole("button", { name: "close" }).click();
    await uiHelper.clickLink("Read more");
    await uiHelper.verifyDivHasText(/^Certified$/);
    await uiHelper.verifyText("About");
    await uiHelper.verifyHeading("Versions");
    await uiHelper.verifyTableHeadingAndRows([
      "Package name",
      "Version",
      "Role",
      "Supported version",
      "Status",
    ]);
    await page.getByRole("button", { name: "close" }).click();
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Certified by Red Hat");
    await extensions.toggleOption("Verified by Red Hat");
    await extensions.clickAway();
    await expect(page.getByLabel("Verified by Red Hat").first()).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip("Verified by Red Hat");
  });

  test.use({
    permissions: ["clipboard-read", "clipboard-write"],
  });

  test("Verify plugin installation", async ({ page }) => {
    await uiHelper.searchInputPlaceholder("Topology");
    await page.getByRole("heading", { name: "Topology" }).first().click();
    await uiHelper.clickButton("Install");
    await uiHelper.verifyHeading("Install Application Topology for Kubernetes");
    await uiHelper.verifyText(
      "- package: ./dynamic-plugins/dist/backstage-community-plugin-topology",
    );
    await uiHelper.verifyText("disabled: false");
    await uiHelper.verifyText("Apply");
    await uiHelper.verifyHeading("Default configuration");
    await uiHelper.clickButton("Apply");
    await uiHelper.verifyText("pluginConfig:");
    await uiHelper.verifyText("dynamicPlugins:");
    await uiHelper.clickTab("About the plugin");
    await uiHelper.verifyHeading("Configuring The Plugin");
    await uiHelper.clickTab("Examples");
    await uiHelper.clickByDataTestId("ContentCopyRoundedIcon");
    await expect(page.getByRole("button", { name: "✔" })).toBeVisible();
    await uiHelper.clickButton("Reset");
    await expect(page.getByText("pluginConfig:")).not.toBeVisible();
    const modifier = isMac ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+KeyA`);
    await page.keyboard.press(`${modifier}+KeyV`);
    await uiHelper.verifyText("pluginConfig:");
    await page.locator("button[class^='copy-button']").click();
    await expect(page.getByRole("button", { name: "✔" }).nth(1)).toBeVisible();
    const clipboardContent = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardContent).not.toContain("pluginConfig:");
    expect(clipboardContent).toContain("backstage-community.plugin-topology:");
    await uiHelper.clickButton("Cancel");
    await expect(page.getByRole("button", { name: "Install" })).toBeVisible();
    await uiHelper.verifyHeading("Install Application Topology for Kubernetes");
  });
});
