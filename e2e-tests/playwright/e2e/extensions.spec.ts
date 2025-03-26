import { test as base, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { Extensions } from "../support/pages/extensions";

const test = base.extend<{ uiHelper: UIhelper; extensions: Extensions }>({
  uiHelper: async ({ page }, use) => {
    use(new UIhelper(page));
  },
});

test.describe("Admin > Extensions > Catalog", () => {
  let extensions: Extensions;
  test.beforeEach(async ({ page, uiHelper }) => {
    await new Common(page).loginAsKeycloakUser();
    extensions = new Extensions(page);
    await uiHelper.openSidebarButton("Administration");
    await uiHelper.openSidebar("Extensions");
    await uiHelper.verifyHeading("Extensions");
  });

  test("Verify search bar in extensions", async ({ page, uiHelper }) => {
    await uiHelper.searchInputPlaceholder("Dynatrace");
    await uiHelper.verifyHeading("DynaTrace");
    await page.getByRole("button", { name: "Clear Search" }).click();
  });

  test("Verify filters in extensions", async ({ page, uiHelper }) => {
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

  test("Verify certified badge in extensions", async ({ page, uiHelper }) => {
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
});
