import { test, expect } from "@playwright/test";
import { Common } from "../utils/common";
import { UIhelper } from "../utils/ui-helper";
import { Extensions } from "../support/pages/extensions";
import { runAccessibilityTests } from "../utils/accessibility";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

test.describe("Admin > Extensions > Catalog", () => {
  let extensions: Extensions;
  let uiHelper: UIhelper;
  const isMac = process.platform === "darwin";

  const commonHeadings = [
    t["plugin.marketplace"][lang]["metadata.versions"],
    t["plugin.marketplace"][lang]["search.author"],
    t["plugin.marketplace"][lang]["package.tags"],
    t["plugin.marketplace"][lang]["metadata.category"],
    t["plugin.marketplace"][lang]["metadata.publisher"],
    t["plugin.marketplace"][lang]["metadata.supportProvider"],
  ];
  const supportTypeOptions = [
    t["plugin.marketplace"][lang]["badges.generallyAvailable"],
    t["plugin.marketplace"][lang]["badges.certified"],
    t["plugin.marketplace"][lang]["badges.customPlugin"],
    t["plugin.marketplace"][lang]["badges.techPreview"],
    t["plugin.marketplace"][lang]["badges.devPreview"],
    t["plugin.marketplace"][lang]["badges.communityPlugin"],
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
    await uiHelper.openSidebarButton(
      t["rhdh"][lang]["menuItem.administration"],
    );
    await uiHelper.openSidebar(t["plugin.marketplace"][lang]["header.title"]);
    await uiHelper.verifyHeading(
      t["plugin.marketplace"][lang]["header.extensions"],
    );
  });

  test("Verify search bar in extensions", async ({ page }) => {
    await uiHelper.searchInputAriaLabel("Dynatrace");
    await uiHelper.verifyHeading("DynaTrace");
    await page
      .getByRole("button", {
        name: t["plugin.marketplace"][lang]["search.clear"],
      })
      .click();
  });

  test("Verify category and author filters in extensions", async ({
    page,
  }, testInfo) => {
    await uiHelper.verifyHeading(/Plugins \(\d+\)/);

    await runAccessibilityTests(page, testInfo);

    await uiHelper.clickTab(t["plugin.marketplace"][lang]["menuItem.catalog"]);
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.category"],
    );
    await extensions.toggleOption("CI/CD");
    await page.getByRole("option", { name: "CI/CD" }).isChecked();
    await page.keyboard.press(`Escape`);
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.author"],
    );
    await extensions.toggleOption("Red Hat");
    await page.keyboard.press(`Escape`);
    await uiHelper.verifyHeading("Red Hat Argo CD");
    await uiHelper.verifyText(
      t["plugin.marketplace"][lang]["metadata.by"] + "Red Hat",
    );
    await page.getByRole("heading", { name: "Red Hat Argo CD" }).click();
    await uiHelper.verifyTableHeadingAndRows([
      "Package name",
      "Version",
      "Role",
      "Backstage compatibility version",
      "Status",
    ]);
    await uiHelper.verifyHeading(
      t["plugin.marketplace"][lang]["metadata.versions"],
    );
    await page
      .getByRole("button", {
        name: "close",
      })
      .click();
    await uiHelper.clickLink(t["plugin.marketplace"][lang]["common.readMore"]);
    await page
      .getByRole("button", {
        name: "close",
      })
      .click();
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.author"],
    );
    await extensions.toggleOption("Red Hat");
    await expect(
      page.getByRole("option", { name: "Red Hat" }).getByRole("checkbox"),
    ).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Red Hat" })).toBeHidden();
    await page.keyboard.press(`Escape`);
    await expect(
      page
        .getByLabel(t["plugin.marketplace"][lang]["search.category"])
        .getByRole("combobox"),
    ).toBeEmpty();
    await page.keyboard.press(`Escape`);
  });

  test("Verify support type filters in extensions", async ({ page }) => {
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.supportType"],
    );
    await expect(page.getByRole("listbox")).toBeVisible();

    // Verify all support type options are present
    for (const option of supportTypeOptions) {
      await expect(page.getByRole("listbox")).toContainText(option);
    }

    await page.keyboard.press("Escape");
    await expect(
      page
        .getByLabel(t["plugin.marketplace"][lang]["search.category"])
        .getByRole("combobox"),
    ).toBeEmpty();
  });

  test("Verify certified badge in extensions", async ({ page }) => {
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.supportType"],
    );
    await extensions.toggleOption(
      t["plugin.marketplace"][lang]["badges.certified"],
    );
    await page.keyboard.press(`Escape`);
    await uiHelper.verifyHeading("DynaTrace");
    await expect(
      page
        .getByLabel(
          t["plugin.marketplace"][lang]["badges.certifiedBy"].replace(
            "{{provider}}",
            "Red Hat",
          ),
        )
        .first(),
    ).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip(
      t["plugin.marketplace"][lang]["badges.certifiedBy"].replace(
        "{{provider}}",
        "Red Hat",
      ),
    );
    await uiHelper.verifyHeading("DynaTrace");
    await page.getByRole("heading", { name: "DynaTrace" }).first().click();
    await page
      .getByRole("button", {
        name: "close",
      })
      .click();
    await uiHelper.clickLink(t["plugin.marketplace"][lang]["common.readMore"]);
    await expect(
      page
        .getByLabel(
          t["plugin.marketplace"][lang]["badges.stableAndSecured"].replace(
            "{{provider}}",
            "Red Hat",
          ),
        )
        .getByText(t["plugin.marketplace"][lang]["badges.certified"]),
    ).toBeVisible();
    await uiHelper.verifyText(t["plugin.marketplace"][lang]["metadata.about"]);
    await uiHelper.verifyHeading(
      t["plugin.marketplace"][lang]["metadata.versions"],
    );
    await uiHelper.verifyTableHeadingAndRows([
      "Package name",
      "Version",
      "Role",
      "Backstage compatibility version",
      "Status",
    ]);
    await page
      .getByRole("button", {
        name: "close",
      })
      .click();
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.supportType"],
    );
    await extensions.toggleOption(
      t["plugin.marketplace"][lang]["badges.certified"],
    );
  });

  test("Verify Generally available badge in extensions", async ({ page }) => {
    await extensions.selectSupportTypeFilter(
      t["plugin.marketplace"][lang]["badges.generallyAvailable"],
    );

    await expect(
      page
        .getByLabel(
          t["plugin.marketplace"][lang]["badges.gaAndSupportedBy"].replace(
            "{{provider}}",
            "Red Hat",
          ),
        )
        .first(),
    ).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip(
      t["plugin.marketplace"][lang]["badges.gaAndSupportedBy"].replace(
        "{{provider}}",
        "Red Hat",
      ),
    );

    await uiHelper.clickLink(t["plugin.marketplace"][lang]["common.readMore"]);
    await expect(
      page
        .getByLabel(
          t["plugin.marketplace"][lang]["badges.productionReadyBy"].replace(
            "{{provider}}",
            "Red Hat",
          ),
        )
        .getByText(t["plugin.marketplace"][lang]["badges.generallyAvailable"]),
    ).toBeVisible();

    for (const heading of commonHeadings) {
      console.log(`Verifying heading: ${heading}`);
      await uiHelper.verifyHeading(heading);
    }

    await page
      .getByRole("button", {
        name: "close",
      })
      .click();

    await extensions.resetSupportTypeFilter(
      t["plugin.marketplace"][lang]["badges.generallyAvailable"],
    );
  });

  // Skipping below test due to the issue: https://issues.redhat.com/browse/RHDHBUGS-2104
  test.skip("Verify custom plugin badge in extensions", async ({ page }) => {
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.supportType"],
    );
    await extensions.toggleOption(
      t["plugin.marketplace"][lang]["badges.customPlugin"],
    );
    await page.keyboard.press(`Escape`);
    await expect(
      page
        .getByLabel(
          t["plugin.marketplace"][lang]["supportTypes.customPlugins"].replace(
            " ({{count}})",
            "",
          ),
        )
        .first(),
    ).toBeVisible();
    await expect(extensions.badge.first()).toBeVisible();
    await extensions.badge.first().hover();
    await uiHelper.verifyTextInTooltip(
      t["plugin.marketplace"][lang]["supportTypes.customPlugins"].replace(
        " ({{count}})",
        "",
      ),
    );
    await uiHelper.clickLink(t["plugin.marketplace"][lang]["common.readMore"]);
    await expect(
      page
        .getByLabel(t["plugin.marketplace"][lang]["badges.addedByAdmin"])
        .getByText("Custom"),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "close",
      })
      .click();
    await extensions.selectDropdown(
      t["plugin.marketplace"][lang]["search.supportType"],
    );
    await extensions.toggleOption(
      t["plugin.marketplace"][lang]["badges.customPlugin"],
    );
    await page.keyboard.press(`Escape`);
  });

  test("Verify tech preview badge in extensions", async () => {
    await extensions.verifySupportTypeBadge({
      supportType: t["plugin.marketplace"][lang]["badges.techPreview"],
      pluginName: "Bulk Import",
      badgeLabel: t["plugin.marketplace"][lang]["badges.pluginInDevelopment"],
      badgeText: t["plugin.marketplace"][lang]["badges.techPreview"],
      tooltipText: "",
      searchTerm: "Bulk Import",
      headings: [
        t["plugin.marketplace"][lang]["metadata.about"],
        t["plugin.marketplace"][lang]["metadata.versions"],
        ...commonHeadings,
      ],
      includeTable: true,
      includeAbout: false,
    });
  });

  test("Verify dev preview badge in extensions", async () => {
    await extensions.selectSupportTypeFilter(
      t["plugin.marketplace"][lang]["badges.devPreview"],
    );
    await uiHelper.verifyHeading("Developer Lightspeed");

    await extensions.verifyPluginDetails({
      pluginName: "Developer Lightspeed",
      badgeLabel:
        t["plugin.marketplace"][lang]["badges.earlyStageExperimental"],
      badgeText: t["plugin.marketplace"][lang]["badges.devPreview"],
      headings: commonHeadings,
      includeTable: true,
      includeAbout: false,
    });

    await extensions.resetSupportTypeFilter(
      t["plugin.marketplace"][lang]["badges.devPreview"],
    );
  });

  test("Verify community plugin badge in extensions", async ({ page }) => {
    await extensions.selectSupportTypeFilter(
      t["plugin.marketplace"][lang]["badges.communityPlugin"],
    );

    await extensions.clickReadMoreByPluginTitle(
      "ServiceNow Integration for Red Hat Developer Hub",
    );
    await expect(
      page
        .getByLabel(t["plugin.marketplace"][lang]["badges.openSourceNoSupport"])
        .getByText(t["plugin.marketplace"][lang]["badges.communityPlugin"]),
    ).toBeVisible();

    await uiHelper.verifyText(t["plugin.marketplace"][lang]["metadata.about"]);
    for (const heading of commonHeadings) {
      console.log(`Verifying heading: ${heading}`);
      await uiHelper.verifyHeading(heading);
    }

    await expect(
      page.getByText(
        t["plugin.marketplace"][lang]["search.author"] + "Red Hat",
      ),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: "close",
      })
      .click();
    await extensions.resetSupportTypeFilter(
      t["plugin.marketplace"][lang]["badges.communityPlugin"],
    );
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
      t["plugin.marketplace"][lang]["alert.productionDisabled"],
      { exact: true },
    );
    await uiHelper.searchInputPlaceholder("Topology");
    await page.getByRole("heading", { name: "Topology" }).first().click();
    await uiHelper.clickButton(t["plugin.marketplace"][lang]["actions.view"]);
    await uiHelper.verifyHeading("Application Topology for Kubernetes");
    await uiHelper.verifyText(
      "- package: ./dynamic-plugins/dist/backstage-community-plugin-topology",
    );
    await uiHelper.verifyText("disabled: false");
    await uiHelper.verifyText(t["plugin.marketplace"][lang]["common.apply"]);
    await uiHelper.verifyHeading("Default configuration");
    await uiHelper.clickButton(t["plugin.marketplace"][lang]["common.apply"]);
    await uiHelper.verifyText("pluginConfig:");
    await uiHelper.verifyText("dynamicPlugins:");
    await uiHelper.clickTab(
      t["plugin.marketplace"][lang]["install.aboutPlugin"],
    );
    await uiHelper.verifyHeading("Configuring The Plugin");
    await uiHelper.clickTab(t["plugin.marketplace"][lang]["install.examples"]);
    await uiHelper.clickByDataTestId("ContentCopyRoundedIcon");
    await expect(page.getByRole("button", { name: "✔" })).toBeVisible();
    await uiHelper.clickButton(t["plugin.marketplace"][lang]["install.reset"]);
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
    await uiHelper.clickButton(t["plugin.marketplace"][lang]["install.back"]);
    await expect(
      page.getByRole("button", {
        name: t["plugin.marketplace"][lang]["actions.view"],
      }),
    ).toBeVisible();
    await uiHelper.verifyHeading("Application Topology for Kubernetes");
  });
});
