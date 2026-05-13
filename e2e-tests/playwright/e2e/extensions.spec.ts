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

test.describe("Admin > Extensions", () => {
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
    "Generally available (GA)",
    "Certified",
    "Tech preview (TP)",
    "Dev preview (DP)",
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
    await uiHelper.openSidebarButton(
      t["rhdh"][lang]["menuItem.administration"],
    );
    await uiHelper.openSidebar("Extensions");
    await uiHelper.verifyHeading("Extensions");
  });

  test.describe("Extensions > Catalog", () => {
    test("Verify search bar in extensions", async ({ page }) => {
      await extensions.searchExtensions("Dynatrace");
      await uiHelper.verifyHeading("DynaTrace");
      await page
        .getByRole("button", {
          name: "Clear Search",
        })
        .click();
    });

    test("Verify category and author filters in extensions", async ({
      page,
    }, testInfo) => {
      await uiHelper.verifyHeading(new RegExp(`^${"Plugins"} \\(\\d+\\)$`));

      await runAccessibilityTests(page, testInfo);

      await uiHelper.clickTab("Catalog");
      await extensions.selectDropdown("Category");
      await extensions.toggleOption("CI/CD");
      await page.getByRole("option", { name: "CI/CD" }).isChecked();
      await page.keyboard.press(`Escape`);
      await extensions.selectDropdown("Author");
      await extensions.toggleOption("Red Hat");
      await page.keyboard.press(`Escape`);
      await uiHelper.verifyHeading("Argo CD");
      await uiHelper.verifyText(" by " + "Red Hat");
      await page.getByRole("heading", { name: "Argo CD" }).click();
      await uiHelper.verifyTableHeadingAndRows([
        "Package name",
        "Version",
        "Role",
        "Backstage compatibility version",
        "Status",
      ]);
      await uiHelper.verifyHeading("Versions");
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await uiHelper.clickLink("Read more");
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.selectDropdown("Author");
      await extensions.toggleOption("Red Hat");
      await expect(
        page.getByRole("option", { name: "Red Hat" }).getByRole("checkbox"),
      ).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Red Hat" })).toBeHidden();
      await page.keyboard.press(`Escape`);
      await expect(
        page.getByLabel("Category").getByRole("combobox"),
      ).toBeEmpty();
      await page.keyboard.press(`Escape`);
    });

    test("Verify support type filters in extensions", async ({ page }) => {
      await extensions.selectDropdown("Support type");
      await expect(page.getByRole("listbox")).toBeVisible();

      // Verify all support type options are present using filter for partial text matching
      for (const option of supportTypeOptions) {
        const optionLocator = page
          .getByRole("option")
          .filter({ hasText: option });
        await expect(optionLocator).toBeVisible();
      }

      await page.keyboard.press("Escape");
      await expect(
        page.getByLabel("Category").getByRole("combobox"),
      ).toBeEmpty();
    });

    test("Verify certified badge in extensions", async ({ page }) => {
      await extensions.selectDropdown("Support type");
      await extensions.toggleOption("Certified");
      await page.keyboard.press(`Escape`);
      await uiHelper.verifyHeading("DynaTrace");
      await expect(
        page
          .getByLabel(
            "Certified by {{provider}}".replace("{{provider}}", "Red Hat"),
          )
          .first(),
      ).toBeVisible();
      await expect(extensions.badge.first()).toBeVisible();
      await extensions.badge.first().hover();
      await uiHelper.verifyTextInTooltip(
        "Certified by {{provider}}".replace("{{provider}}", "Red Hat"),
      );
      await uiHelper.verifyHeading("DynaTrace");
      await page.getByRole("heading", { name: "DynaTrace" }).first().click();
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await uiHelper.clickLink("Read more");
      await expect(
        page
          .getByLabel(
            "Stable and secured by {{provider}}".replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .getByText("Certified"),
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
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.selectDropdown("Support type");
      await extensions.toggleOption("Certified");
    });

    test("Verify Generally available badge in extensions", async ({ page }) => {
      await extensions.selectSupportTypeFilter("Generally available (GA)");

      await expect(
        page
          .getByLabel(
            "Generally available (GA) and supported by {{provider}}".replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .first(),
      ).toBeVisible();
      await expect(extensions.badge.first()).toBeVisible();
      await extensions.badge.first().hover();
      await uiHelper.verifyTextInTooltip(
        "Generally available (GA) and supported by {{provider}}".replace(
          "{{provider}}",
          "Red Hat",
        ),
      );

      await uiHelper.clickLink("Read more");
      await expect(
        page
          .getByLabel(
            "Production-ready and supported by {{provider}}".replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .getByText("Generally available (GA)"),
      ).toBeVisible();

      for (const heading of commonHeadings) {
        await uiHelper.verifyHeading(heading);
      }

      await page
        .getByRole("button", {
          name: "close",
        })
        .click();

      await extensions.resetSupportTypeFilter("Generally available (GA)");
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
      await uiHelper.verifyHeading("Konflux");

      await extensions.verifyPluginDetails({
        pluginName: "Konflux",
        badgeLabel: "An early-stage, experimental plugin",
        badgeText: "Dev preview (DP)",
        headings: commonHeadings,
        includeTable: true,
        includeAbout: false,
      });

      await extensions.resetSupportTypeFilter("Dev preview (DP)");
    });

    test("Verify community plugin badge in extensions", async ({ page }) => {
      await extensions.selectSupportTypeFilter("Community plugin");

      await extensions.clickReadMoreByPluginTitle(
        "ServiceNow Integration for Red Hat Developer Hub",
        "Community plugin",
      );
      await expect(
        page
          .getByLabel("Open-source plugins, no official support")
          .getByText("Community plugin"),
      ).toBeVisible();

      await uiHelper.verifyText("About");
      for (const heading of commonHeadings) {
        await uiHelper.verifyHeading(heading);
      }

      await expect(page.getByText("Author" + "Red Hat")).toBeVisible();

      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.resetSupportTypeFilter("Community plugin");
    });

    test.use({
      permissions: ["clipboard-read", "clipboard-write"],
    });

    // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
    test("Verify plugin configuration can be viewed in the production environment", async ({
      page,
    }) => {
      const productionEnvAlert = page.getByRole("alert").first();
      productionEnvAlert.getByText(
        "Plugin installation is disabled in the production environment.",
        {
          exact: true,
        },
      );
      await extensions.searchExtensions("Topology");
      await extensions.waitForSearchResults("Topology");
      await extensions.clickReadMoreByPluginTitle(
        "Application Topology for Kubernetes",
        "Generally available (GA)",
      );
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
      await page.locator(".copy-button").first().click();
      await expect(
        page.getByRole("button", { name: "✔" }).nth(0),
      ).toBeVisible();
      const clipboardContent = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(clipboardContent).not.toContain("pluginConfig:");
      expect(clipboardContent).toContain(
        "backstage-community.plugin-topology:",
      );
      await uiHelper.clickButton("Back");
      await expect(
        page.getByRole("button", {
          name: new RegExp(`^${"View"}$`),
        }),
      ).toBeVisible();
      await uiHelper.verifyHeading("Application Topology for Kubernetes");
    });

    //Following test is disabled for CI as plugin installation is disabled in CI
    test("Enable plugin from catalog extension page", async ({ page }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      test.fixme();
      await uiHelper.clickByDataTestId("header-tab-0");
      await extensions.clickReadMoreByPluginTitle(
        "Adoption Insights for Red Hat Developer Hub",
        "Generally available (GA)",
      );
      await uiHelper.verifyHeading("Adoption Insights for Red Hat");
      await page.getByTestId("plugin-actions").click();
      await expect(page.getByLabel("EditPlugin")).toBeVisible();
      await page.getByTestId("disable-plugin").click();
      await expect(page.getByTestId("enable-plugin")).toBeVisible();
    });
  });

  test.describe("Extensions > Installed Plugin", () => {
    test.beforeEach(async () => {
      await uiHelper.clickByDataTestId("header-tab-1");
      await uiHelper.verifyHeading(
        new RegExp(`^${"Installed packages"} \\(\\d+\\)$`),
      );
    });

    test("Installed packages page", async ({ page }, testInfo) => {
      await runAccessibilityTests(page, testInfo);
      await uiHelper.verifyTableHeadingAndRows([
        "Name",
        "npm package name",
        "Role",
        "Version",
        "Actions",
      ]);
      await page.waitForTimeout(2000);
      await page
        .getByRole("button", {
          name: "Name",
          exact: true,
        })
        .click();
      await uiHelper.verifyRowInTableByUniqueText("TechDocs Add-ons Contrib", [
        /backstage-plugin-techdocs-module-addons-contrib/,
        /Frontend plugin module/,
        /(\d+)\.(\d+)\.(\d+)/,
      ]);
      const techdocsRow = page.getByRole("row", {
        name: "backstage-plugin-techdocs-module-addons-contrib",
      });

      await expect(techdocsRow).toBeVisible();

      // Wait specifically for the Actions cell (5th cell / last cell) to be rendered
      const actionsCell = techdocsRow.getByLabel(
        "Package cannot be managed in the production environment.",
      );
      await expect(actionsCell).toHaveCount(3);
      for (const button of await actionsCell.all()) {
        await expect(button).toBeVisible();
      }
      await page
        .getByRole("button", {
          name: new RegExp(`rows 5 rows`),
        })
        .click();
      await page.getByRole("option", { name: "10", exact: true }).click();
      await page
        .getByRole("button", {
          name: new RegExp(`rows 10 rows`),
        })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", {
          name: new RegExp(`rows 10 rows`),
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Next Page" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Previous Page" }),
      ).toBeVisible();
    });

    test("Global Header package sidebar for CI", async ({ page }) => {
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .click();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .fill("Global Header");
      await expect(
        page.getByRole("cell", {
          name: "red-hat-developer-hub-backstage-plugin-global-header",
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row", { name: "Global Header red-hat-developer-hub" })
          .getByRole("button")
          .first(),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row", {
            name: "Global Header red-hat-developer-hub-backstage-plugin-global-header",
          })
          .getByTestId("FileDownloadOutlinedIcon"),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row", {
            name: "Global Header red-hat-developer-hub-backstage-plugin-global-header",
          })
          .getByRole("checkbox"),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: "Global Header",
        })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Global Header",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "View",
        }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "View",
        })
        .hover();
      // Following commented code to be updated when the tooltip message is available in the production env with pr https://github.com/redhat-developer/rhdh/pull/3565
      // await uiHelper.verifyTextInTooltip(
      //   "You don't have permission to install plugins or view their configurations. Contact your administrator to request access or assistance",
      // );
      await page.getByRole("button", { name: "close" }).click();
      await expect(
        page
          .getByRole("cell", {
            name: "Package cannot be managed in the production environment",
          })
          .first(),
      ).toBeVisible();
    });

    //Following test is disabled for CI as plugin installation is disabled in CI
    test("Edit Analytics provider segment package through side menu ", async ({
      page,
    }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      test.fixme();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .click();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .fill("Analytics provider segment");
      await expect(
        page.getByRole("cell", { name: "Analytics Provider Segment" }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Analytics Provider Segment" })
        .click();
      await page.getByTestId("plugin-actions").click();
      await page.getByTestId("edit-configuration").click();
      await uiHelper.verifyHeading("Edit instructions");
      await expect(page.getByRole("tab", { name: "Examples" })).toBeVisible();
      await uiHelper.verifyHeading(
        "backstage-community-plugin-analytics-provider-segment",
      );
      await expect(page.getByText("SaveCancelReset")).toBeVisible();
      await expect(page.getByText('plugins: - package: "./')).toBeVisible();
      await page
        .getByRole("button", {
          name: "Apply",
        })
        .click();
      await expect(page.getByRole("code")).toContainText(
        "testMode: ${SEGMENT_TEST_MODE}",
      );
      await page
        .getByRole("button", {
          name: "Reset",
        })
        .click();
      await expect(page.getByRole("code")).not.toContainText(
        "testMode: ${SEGMENT_TEST_MODE}",
      );
      await page
        .getByRole("button", {
          name: "Cancel",
        })
        .click();
      await expect(
        page.getByText("Analytics Provider Segmentby"),
      ).toBeVisible();
      await page.getByRole("button", { name: "close" }).click();
    });

    //Following test is disabled for CI as plugin installation is disabled in CI
    test("Edit Analytics provider segment package through action cell in the installed package row ", async ({
      page,
    }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      test.fixme();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .click();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .fill("Analytics provider segment");
      await expect(
        page.getByRole("cell", { name: "Analytics Provider Segment" }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Edit package configuration",
        })
        .click();
      await uiHelper.verifyHeading("Edit instructions");
      await expect(page.getByText("SaveCancelReset")).toBeVisible();
      await page
        .getByRole("button", {
          name: "Save",
        })
        .click();
      await uiHelper.verifyHeading(
        new RegExp(`^${"Installed packages"} \\(\\d+\\)$`),
        10000,
      );
      await expect(page.getByRole("alert").first()).toContainText(
        "The Analytics Provider Segment package requires a restart of the backend system to finish installing, updating, enabling or disabling.",
        { timeout: 10000 },
      );
    });

    //Following test is disabled for CI as plugin installation is disabled in CI
    test("Plugin enable-disable toggle in action cell in the installed package row ", async ({
      page,
    }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      test.fixme();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .click();
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .fill("Dynamic Home Page");
      await expect(
        page.getByRole("cell", { name: "Dynamic Home Page" }),
      ).toBeVisible();
      await page.getByRole("checkbox").hover();
      await expect(page.getByLabel("Disable package")).toBeVisible();
      await page.getByRole("checkbox").click();
      await expect(page.getByRole("alert").first()).toContainText(
        "The red-hat-developer-hub-backstage-plugin-dynamic-home-page package requires a restart of the backend system to finish installing, updating, enabling or disabling.",
        { timeout: 15000 },
      );
      await page
        .getByRole("textbox", {
          name: "Search",
        })
        .fill("Global Header");
      await expect(
        page.getByRole("cell", { name: "Global Header" }),
      ).toBeVisible();
      await page.getByRole("checkbox").hover();
      await expect(page.getByLabel("Disable package")).toBeVisible();
      await page.getByRole("checkbox").click();

      await page
        .getByRole("button", {
          name: "View packages",
        })
        .click();
      await expect(
        page
          .getByLabel("Backend restart required")
          .getByText("Backend restart required"),
      ).toBeVisible({ timeout: 10000 });

      const packageVerifications = [
        { rowTitle: "Name", rowValue: "Action" },
        {
          rowTitle: "red-hat-developer-hub-backstage-plugin-dynamic-home-page",
          rowValue: "Package disabled",
        },
        {
          rowTitle: "red-hat-developer-hub-backstage-plugin-global-header",
          rowValue: "Package disabled",
        },
      ];

      for (const { rowTitle, rowValue } of packageVerifications) {
        await extensions.verifyKeyValueRowElements(rowTitle, rowValue);
      }

      await expect(page.getByText("To finish the package")).toBeVisible();
      await page.getByRole("button", { name: "close", exact: true }).click();
    });
  });
});
