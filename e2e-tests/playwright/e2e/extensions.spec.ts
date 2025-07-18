import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { Extensions } from "../support/pages/extensions";
import { runAccessibilityTests } from "../utils/accessibility";

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

  test("Verify filters in extensions", async ({ page }, testInfo) => {
    await uiHelper.verifyHeading(/Plugins \(\d+\)/);

    await runAccessibilityTests(page, testInfo);

    await uiHelper.clickTab("Catalog");
    await uiHelper.clickButton("CI/CD");
    await extensions.selectDropdown("Category");
    await page.getByRole("option", { name: "CI/CD" }).isChecked();
    await page.keyboard.press(`Escape`);
    await extensions.selectDropdown("Author");
    await extensions.toggleOption("Red Hat");
    await page.keyboard.press(`Escape`);
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
    await expect(
      page.getByRole("option", { name: "Red Hat" }).getByRole("checkbox"),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Red Hat" }),
    ).not.toBeVisible();
    await page.keyboard.press(`Escape`);
    await page.getByTestId("CancelIcon").first().click();
    await expect(page.getByLabel("Category").getByRole("combobox")).toBeEmpty();
    await page.keyboard.press(`Escape`);
  });

  test("Verify certified badge in extensions", async ({ page }) => {
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Certified by Red Hat");
    await page.keyboard.press(`Escape`);
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
    await page.keyboard.press(`Escape`);
    await expect(page.getByLabel("Verified by Red Hat").first()).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip("Verified by Red Hat");
  });

  test.use({
    permissions: ["clipboard-read", "clipboard-write"],
  });

  test("Verify plugin configuration can be viewed in the production environment", async ({
    page,
  }) => {
    const productionEnvAlert = page
      .locator('div[class*="MuiAlertTitle-root"]')
      .first();
    productionEnvAlert.getByText(
      "Plugin installation is disabled in the production environment.",
      { exact: true },
    );
    await uiHelper.searchInputPlaceholder("Topology");
    await page.getByRole("heading", { name: "Topology" }).first().click();
    await uiHelper.clickButton("View");
    await uiHelper.verifyHeading("Application Topology for Kubernetes");
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
    await uiHelper.clickButton("Back");
    await expect(page.getByRole("button", { name: "View" })).toBeVisible();
    await uiHelper.verifyHeading("Application Topology for Kubernetes");
  });

  // Enable this when the plugin is installation is enabled in the production environment
  test.skip("Verify plugin configuration is editable and can be enabled when disabled", async ({
    page,
  }) => {
    await uiHelper.searchInputPlaceholder("Topology");
    await page.getByRole("heading", { name: "Topology" }).first().click();
    await uiHelper.verifyHeading("Application Topology for Kubernetes");
    await uiHelper.clickButton("Actions");
    await uiHelper.clickByDataTestId("edit-configuration");
    await uiHelper.verifyHeading(
      "Edit Application Topology for Kubernetes configurations",
    );
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
    await uiHelper.clickButton("Save");
    await uiHelper.verifyHeading("Extensions");
    let alert = page.getByRole("alert").first();
    expect(alert).toContainText("Backend restart required");
    expect(alert).toContainText(
      "The Application Topology for Kubernetes plugin requires a restart of the backend system to finish installing, updating, enabling or disabling.",
    );
    await uiHelper.searchInputPlaceholder("Argo CD Software Template Actions");
    await page
      .getByRole("heading", { name: "Argo CD Software Template Actions" })
      .first()
      .click();

    await uiHelper.clickButton("Actions");
    await uiHelper.clickByDataTestId("enable-plugin");
    await uiHelper.verifyHeading("Extensions");
    alert = page.getByRole("alert").first();
    expect(alert).toContainText("Backend restart required");
    expect(alert).toContainText(
      "You have 2 plugins that require a restart of your backend system to either finish installing, updating, enabling or disabling.",
    );
    page.getByText("View plugins", { exact: true }).click();
    const rowLocator = page.locator(`tbody>tr`).nth(1);
    await rowLocator.waitFor({ state: "visible" });
    const nameCell = rowLocator.locator("th");
    const actionCell = rowLocator.locator("td");
    await expect(nameCell).toHaveText("Argo CD Software Template Actions");
    await expect(actionCell).toContainText("Plugin enabled");
    await uiHelper.verifyText(
      "To finish the plugin modifications, restart your backend system.",
    );
    await uiHelper.clickButton("Close");
  });
});
