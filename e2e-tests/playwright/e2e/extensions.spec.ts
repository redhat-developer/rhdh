import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { Extensions } from "../support/pages/extensions";
import { runAccessibilityTests } from "../utils/accessibility";

test.describe("Admin > Extensions > Catalog", () => {
  let extensions: Extensions;
  let uiHelper: UIhelper;
  const isMac = process.platform === "darwin";

  const commonHeadings = [
    "Versions",
    "Author",
    "Tags",
    "Category",
    "Publisher",
    "Support Provider",
  ];
  const supportTypeOptions = [
    "Generally available",
    "Certified",
    "Custom plugin",
    "Tech preview",
    "Dev preview",
    "Community plugin",
  ];

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });
  });

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

  test("Verify category and author filters in extensions", async ({
    page,
  }, testInfo) => {
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
      "Backstage compatibility version",
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
    await expect(page.getByRole("button", { name: "Red Hat" })).toBeHidden();
    await page.keyboard.press(`Escape`);
    await expect(page.getByLabel("Category").getByRole("combobox")).toBeEmpty();
    await page.keyboard.press(`Escape`);
  });

  test("Verify support type filters in extensions", async ({ page }) => {
    await extensions.selectDropdown("Support type");
    await expect(page.getByRole("listbox")).toBeVisible();

    // Verify all support type options are present
    for (const option of supportTypeOptions) {
      await expect(page.getByRole("listbox")).toContainText(option);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Category").getByRole("combobox")).toBeEmpty();
  });

  test("Verify certified badge in extensions", async ({ page }) => {
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Certified");
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
    await expect(
      page.getByLabel("Stable and secured by Red Hat").getByText("Certified"),
    ).toBeVisible();
    await uiHelper.verifyText("About");
    await uiHelper.verifyHeading("Versions");
    await uiHelper.verifyTableHeadingAndRows([
      "Package name",
      "Version",
      "Role",
      "Backstage compatibility version",
      "Status",
    ]);
    await page.getByRole("button", { name: "close" }).click();
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Certified");
  });

  test("Verify Generally available badge in extensions", async ({ page }) => {
    await extensions.selectSupportTypeFilter("Generally available (GA)");

    await expect(
      page
        .getByLabel("Generally available (GA) and supported by Red Hat")
        .first(),
    ).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip(
      "Generally available (GA) and supported by Red Hat",
    );

    await uiHelper.clickLink("Read more");
    await expect(
      page
        .getByLabel("Production-ready and supported by Red Hat")
        .getByText("Generally available (GA)"),
    ).toBeVisible();

    for (const heading of commonHeadings) {
      console.log(`Verifying heading: ${heading}`);
      await uiHelper.verifyHeading(heading);
    }

    await page.getByRole("button", { name: "close" }).click();

    await extensions.resetSupportTypeFilter("Generally available (GA)");
  });

  // Skipping below test due to the issue: https://issues.redhat.com/browse/RHDHBUGS-2104
  test.skip("Verify custom plugin badge in extensions", async ({ page }) => {
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Custom plugin");
    await page.keyboard.press(`Escape`);
    await expect(page.getByLabel("Custom plugins").first()).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip("Custom plugins");
    await uiHelper.clickLink("Read more");
    await expect(
      page.getByLabel("Plugins added by the administrator").getByText("Custom"),
    ).toBeVisible();
    await page.getByRole("button", { name: "close" }).click();
    await extensions.selectDropdown("Support type");
    await extensions.toggleOption("Custom plugin");
    await page.keyboard.press(`Escape`);
  });

  test("Verify tech preview badge in extensions", async () => {
    await extensions.verifySupportTypeBadge({
      supportType: "Tech preview (TP)",
      pluginName: "Bulk Import",
      badgeLabel: "Plugin still in development",
      badgeText: "Tech preview (TP)",
      tooltipText: "",
      searchTerm: "Bulk Import",
      headings: ["About", "Versions", ...commonHeadings],
      includeTable: true,
      includeAbout: false,
    });
  });

  test("Verify dev preview badge in extensions", async () => {
    await extensions.selectSupportTypeFilter("Dev preview (DP)");
    await uiHelper.verifyHeading("Developer Lightspeed");

    await extensions.verifyPluginDetails({
      pluginName: "Developer Lightspeed",
      badgeLabel: "An early-stage, experimental",
      badgeText: "Dev preview (DP)",
      headings: commonHeadings,
      includeTable: true,
      includeAbout: false,
    });

    await extensions.resetSupportTypeFilter("Dev preview (DP)");
  });

  test("Verify community plugin badge in extensions", async ({ page }) => {
    await extensions.selectSupportTypeFilter("Community plugin");

    await uiHelper.clickLink("Read more");
    await expect(
      page
        .getByLabel("Open-source plugins, no official support")
        .getByText("Community plugin"),
    ).toBeVisible();

    await uiHelper.verifyText("About");
    for (const heading of commonHeadings) {
      console.log(`Verifying heading: ${heading}`);
      await uiHelper.verifyHeading(heading);
    }

    await expect(page.getByText("AuthorRed Hat")).toBeVisible();

    await page.getByRole("button", { name: "close" }).click();
    await extensions.resetSupportTypeFilter("Community plugin");
  });

  test.use({
    permissions: ["clipboard-read", "clipboard-write"],
  });

  test.skip("Verify plugin configuration can be viewed in the production environment", async ({
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
    await expect(page.getByText("pluginConfig:")).toBeHidden();
    // eslint-disable-next-line playwright/no-conditional-in-test
    const modifier = isMac ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+KeyA`);
    await page.keyboard.press(`${modifier}+KeyV`);
    await uiHelper.verifyText("pluginConfig:");
    await page.locator("button[class^='copy-button']").nth(0).click();
    await expect(page.getByRole("button", { name: "✔" }).nth(0)).toBeVisible();
    const clipboardContent = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardContent).not.toContain("pluginConfig:");
    expect(clipboardContent).toContain("backstage-community.plugin-topology:");
    await uiHelper.clickButton("Back");
    await expect(page.getByRole("button", { name: "View" })).toBeVisible();
    await uiHelper.verifyHeading("Application Topology for Kubernetes");
  });
});
