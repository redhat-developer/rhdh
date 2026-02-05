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
    t["plugin.extensions"][lang]["metadata.versions"],
    t["plugin.extensions"][lang]["search.author"],
    t["plugin.extensions"][lang]["package.tags"],
    t["plugin.extensions"][lang]["metadata.category"],
    t["plugin.extensions"][lang]["metadata.publisher"],
    t["plugin.extensions"][lang]["metadata.supportProvider"],
  ];
  const supportTypeOptions = [
    t["plugin.extensions"][lang]["badges.generallyAvailable"],
    t["plugin.extensions"][lang]["badges.certified"],
    // TODO: Custom plugin is not on the list: https://issues.redhat.com/browse/RHDHBUGS-2153
    // t["plugin.extensions"][lang]["badges.customPlugin"],
    t["plugin.extensions"][lang]["badges.techPreview"],
    t["plugin.extensions"][lang]["badges.devPreview"],
    t["plugin.extensions"][lang]["badges.communityPlugin"],
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
      // TODO: RHDHBUGS-2584 - Administration sidebar menu not translating
      // label: t["rhdh"][lang]["menuItem.administration"],
      "Administration",
    );
    await uiHelper.openSidebar(t["plugin.extensions"][lang]["header.title"]);
    await uiHelper.verifyHeading(
      t["plugin.extensions"][lang]["header.extensions"],
    );
  });

  test.describe("Extensions > Catalog", () => {
    test("Verify search bar in extensions", async ({ page }) => {
      await extensions.searchExtensions("Dynatrace");
      await uiHelper.verifyHeading("DynaTrace");
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang]["search.clear"],
        })
        .click();
    });

    test("Verify category and author filters in extensions", async ({
      page,
    }, testInfo) => {
      await uiHelper.verifyHeading(
        new RegExp(
          `^${t["plugin.extensions"][lang]["header.pluginsPage"]} \\(\\d+\\)$`,
        ),
      );

      await runAccessibilityTests(page, testInfo);

      await uiHelper.clickTab(t["plugin.extensions"][lang]["header.catalog"]);
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.category"],
      );
      await extensions.toggleOption("CI/CD");
      await page.getByRole("option", { name: "CI/CD" }).isChecked();
      await page.keyboard.press(`Escape`);
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.author"],
      );
      await extensions.toggleOption("Red Hat");
      await page.keyboard.press(`Escape`);
      await uiHelper.verifyHeading("Argo CD");
      await uiHelper.verifyText(
        t["plugin.extensions"][lang]["metadata.by"] + "Red Hat",
      );
      await page.getByRole("heading", { name: "Argo CD" }).click();
      await uiHelper.verifyTableHeadingAndRows([
        t["plugin.extensions"][lang]["table.packageName"],
        t["plugin.extensions"][lang]["table.version"],
        t["plugin.extensions"][lang]["table.role"],
        t["plugin.extensions"][lang]["metadata.backstageCompatibility"],
        t["plugin.extensions"][lang]["table.status"],
      ]);
      await uiHelper.verifyHeading(
        t["plugin.extensions"][lang]["metadata.versions"],
      );
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await uiHelper.clickLink(t["plugin.extensions"][lang]["common.readMore"]);
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.author"],
      );
      await extensions.toggleOption("Red Hat");
      await expect(
        page.getByRole("option", { name: "Red Hat" }).getByRole("checkbox"),
      ).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Red Hat" })).toBeHidden();
      await page.keyboard.press(`Escape`);
      await expect(
        page
          .getByLabel(t["plugin.extensions"][lang]["search.category"])
          .getByRole("combobox"),
      ).toBeEmpty();
      await page.keyboard.press(`Escape`);
    });

    test("Verify support type filters in extensions", async ({ page }) => {
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.supportType"],
      );
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
        page
          .getByLabel(t["plugin.extensions"][lang]["search.category"])
          .getByRole("combobox"),
      ).toBeEmpty();
    });

    test("Verify certified badge in extensions", async ({ page }) => {
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.supportType"],
      );
      await extensions.toggleOption(
        t["plugin.extensions"][lang]["badges.certified"],
      );
      await page.keyboard.press(`Escape`);
      await uiHelper.verifyHeading("DynaTrace");
      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["badges.certifiedBy"].replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .first(),
      ).toBeVisible();
      await expect(extensions.badge.first()).toBeVisible();
      await extensions.badge.first().hover();
      await uiHelper.verifyTextInTooltip(
        t["plugin.extensions"][lang]["badges.certifiedBy"].replace(
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
      await uiHelper.clickLink(t["plugin.extensions"][lang]["common.readMore"]);
      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["badges.stableAndSecured"].replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .getByText(t["plugin.extensions"][lang]["badges.certified"]),
      ).toBeVisible();
      await uiHelper.verifyText(t["plugin.extensions"][lang]["metadata.about"]);
      await uiHelper.verifyHeading(
        t["plugin.extensions"][lang]["metadata.versions"],
      );
      await uiHelper.verifyTableHeadingAndRows([
        t["plugin.extensions"][lang]["table.packageName"],
        t["plugin.extensions"][lang]["table.version"],
        t["plugin.extensions"][lang]["table.role"],
        t["plugin.extensions"][lang]["metadata.backstageCompatibility"],
        t["plugin.extensions"][lang]["table.status"],
      ]);
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.supportType"],
      );
      await extensions.toggleOption(
        t["plugin.extensions"][lang]["badges.certified"],
      );
    });

    test("Verify Generally available badge in extensions", async ({ page }) => {
      await extensions.selectSupportTypeFilter(
        t["plugin.extensions"][lang]["badges.generallyAvailable"],
      );

      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["badges.gaAndSupportedBy"].replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .first(),
      ).toBeVisible();
      await expect(extensions.badge.first()).toBeVisible();
      await extensions.badge.first().hover();
      await uiHelper.verifyTextInTooltip(
        t["plugin.extensions"][lang]["badges.gaAndSupportedBy"].replace(
          "{{provider}}",
          "Red Hat",
        ),
      );

      await uiHelper.clickLink(t["plugin.extensions"][lang]["common.readMore"]);
      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["badges.productionReadyBy"].replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .getByText(t["plugin.extensions"][lang]["badges.generallyAvailable"]),
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
        t["plugin.extensions"][lang]["badges.generallyAvailable"],
      );
    });

    test("Verify custom plugin badge in extensions", async ({ page }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2104
      test.fixme();
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.supportType"],
      );
      await extensions.toggleOption(
        t["plugin.extensions"][lang]["badges.customPlugin"],
      );
      await page.keyboard.press(`Escape`);
      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["supportTypes.customPlugins"].replace(
              " ({{count}})",
              "",
            ),
          )
          .first(),
      ).toBeVisible();
      await expect(extensions.badge.first()).toBeVisible();
      await extensions.badge.first().hover();
      await uiHelper.verifyTextInTooltip(
        t["plugin.extensions"][lang]["supportTypes.customPlugins"].replace(
          " ({{count}})",
          "",
        ),
      );
      await uiHelper.clickLink(t["plugin.extensions"][lang]["common.readMore"]);
      await expect(
        page
          .getByLabel(t["plugin.extensions"][lang]["badges.addedByAdmin"])
          .getByText("Custom"),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.selectDropdown(
        t["plugin.extensions"][lang]["search.supportType"],
      );
      await extensions.toggleOption(
        t["plugin.extensions"][lang]["badges.customPlugin"],
      );
      await page.keyboard.press(`Escape`);
    });

    test("Verify tech preview badge in extensions", async () => {
      await extensions.verifySupportTypeBadge({
        supportType: t["plugin.extensions"][lang]["badges.techPreview"],
        pluginName: "Bulk Import",
        badgeLabel: t["plugin.extensions"][lang]["badges.pluginInDevelopment"],
        badgeText: t["plugin.extensions"][lang]["badges.techPreview"],
        tooltipText: "",
        searchTerm: "Bulk Import",
        headings: [
          t["plugin.extensions"][lang]["metadata.about"],
          t["plugin.extensions"][lang]["metadata.versions"],
          ...commonHeadings,
        ],
        includeTable: true,
        includeAbout: false,
      });
    });

    test("Verify dev preview badge in extensions", async () => {
      await extensions.selectSupportTypeFilter(
        t["plugin.extensions"][lang]["badges.devPreview"],
      );
      await uiHelper.verifyHeading("Developer Lightspeed");

      await extensions.verifyPluginDetails({
        pluginName: "Red Hat Developer Lightspeed for Red Hat Developer Hub",
        badgeLabel:
          t["plugin.extensions"][lang]["badges.earlyStageExperimental"],
        badgeText: t["plugin.extensions"][lang]["badges.devPreview"],
        headings: commonHeadings,
        includeTable: true,
        includeAbout: false,
      });

      await extensions.resetSupportTypeFilter(
        t["plugin.extensions"][lang]["badges.devPreview"],
      );
    });

    test("Verify community plugin badge in extensions", async ({ page }) => {
      await extensions.selectSupportTypeFilter(
        t["plugin.extensions"][lang]["badges.communityPlugin"],
      );

      await extensions.clickReadMoreByPluginTitle(
        "ServiceNow Integration for Red Hat Developer Hub",
        t["plugin.extensions"][lang]["badges.communityPlugin"],
      );
      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["badges.openSourceNoSupport"],
          )
          .getByText(t["plugin.extensions"][lang]["badges.communityPlugin"]),
      ).toBeVisible();

      await uiHelper.verifyText(t["plugin.extensions"][lang]["metadata.about"]);
      for (const heading of commonHeadings) {
        console.log(`Verifying heading: ${heading}`);
        await uiHelper.verifyHeading(heading);
      }

      await expect(
        page.getByText(
          t["plugin.extensions"][lang]["search.author"] + "Red Hat",
        ),
      ).toBeVisible();

      await page
        .getByRole("button", {
          name: "close",
        })
        .click();
      await extensions.resetSupportTypeFilter(
        t["plugin.extensions"][lang]["badges.communityPlugin"],
      );
    });

    test.use({
      permissions: ["clipboard-read", "clipboard-write"],
    });

    // Test case is disabled due to bug https://issues.redhat.com/browse/RHDHBUGS-799
    test.fixme("Verify plugin configuration can be viewed in the production environment", async ({
      page,
    }) => {
      const productionEnvAlert = page.getByRole("alert").first();
      productionEnvAlert.getByText(
        t["plugin.extensions"][lang]["alert.productionDisabled"],
        { exact: true },
      );
      await extensions.searchExtensions("Topology");
      await extensions.waitForSearchResults("Topology");
      await extensions.clickReadMoreByPluginTitle(
        "Application Topology for Kubernetes",
        t["plugin.extensions"][lang]["badges.generallyAvailable"],
      );
      await uiHelper.clickButton(t["plugin.extensions"][lang]["actions.view"]);
      await uiHelper.verifyHeading("Application Topology for Kubernetes");
      await uiHelper.verifyText(
        "- package: ./dynamic-plugins/dist/backstage-community-plugin-topology",
      );
      await uiHelper.verifyText("disabled: false");
      await uiHelper.verifyText(t["plugin.extensions"][lang]["common.apply"]);
      await uiHelper.verifyHeading("Default configuration");
      await uiHelper.clickButton(t["plugin.extensions"][lang]["common.apply"]);
      await uiHelper.verifyText("pluginConfig:");
      await uiHelper.verifyText("dynamicPlugins:");
      await uiHelper.clickTab(
        t["plugin.extensions"][lang]["install.aboutPlugin"],
      );
      await uiHelper.verifyHeading("Configuring The Plugin");
      await uiHelper.clickTab(t["plugin.extensions"][lang]["install.examples"]);
      await uiHelper.clickByDataTestId("ContentCopyRoundedIcon");
      await expect(page.getByRole("button", { name: "✔" })).toBeVisible();
      await uiHelper.clickButton(t["plugin.extensions"][lang]["install.reset"]);
      await expect(page.getByText("pluginConfig:")).toBeHidden();
      // eslint-disable-next-line playwright/no-conditional-in-test
      const modifier = isMac ? "Meta" : "Control";
      await page.keyboard.press(`${modifier}+KeyA`);
      await page.keyboard.press(`${modifier}+KeyV`);
      await uiHelper.verifyText("pluginConfig:");
      await page.getByRole("button", { name: /copy/i }).first().click();
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
      await uiHelper.clickButton(t["plugin.extensions"][lang]["install.back"]);
      await expect(
        page.getByRole("button", {
          name: t["plugin.extensions"][lang]["actions.view"],
        }),
      ).toBeVisible();
      await uiHelper.verifyHeading("Application Topology for Kubernetes");
    });

    //Following test is disabled for CI as plugin installation is disabled in CI
    test("Enable plugin from catalog extension page", async ({ page }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      // test.fixme();
      await uiHelper.clickTab(t["plugin.extensions"][lang]["menuItem.catalog"]);
      await extensions.clickReadMoreByPluginTitle(
        "Adoption Insights for Red Hat Developer Hub",
        t["plugin.extensions"][lang]["badges.communityPlugin"],
      );
      await uiHelper.verifyHeading("Adoption Insights for Red Hat");
      await page.getByTestId("plugin-actions").click();
      await expect(page.getByLabel("EditPlugin")).toBeVisible();
      await page.getByTestId("disable-plugin").click();
      const alertText = await page.getByRole("alert").first().textContent();
      expect(alertText).toContain(
        t["plugin.extensions"][lang]["alert.backendRestartRequired"],
      );
      expect(alertText).toContain(
        "The Adoption Insights for Red Hat Developer Hub plugin requires a restart of the backend system to finish installing, updating, enabling or disabling.",
      );
    });
  });

  test.describe("Extensions > Installed Plugin", () => {
    test.beforeEach(async () => {
      await uiHelper.clickTab(
        t["plugin.extensions"][lang]["header.installedPackages"],
      );
      await uiHelper.verifyHeading(
        new RegExp(
          `^${t["plugin.extensions"][lang]["header.installedPackages"]} \\(\\d+\\)$`,
        ),
      );
    });

    test("Installed packages page", async ({ page }, testInfo) => {
      await runAccessibilityTests(page, testInfo);
      await uiHelper.verifyTableHeadingAndRows([
        t["plugin.extensions"][lang]["installedPackages.table.columns.name"],
        t["plugin.extensions"][lang][
          "installedPackages.table.columns.packageName"
        ],
        t["plugin.extensions"][lang]["installedPackages.table.columns.role"],
        t["plugin.extensions"][lang]["installedPackages.table.columns.version"],
        t["plugin.extensions"][lang]["installedPackages.table.columns.actions"],
      ]);
      await page.waitForTimeout(2000);
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.columns.name"
          ],
          exact: true,
        })
        .click();
      await uiHelper.verifyRowInTableByUniqueText("TechDocs Add-ons Contrib", [
        /backstage-plugin-techdocs-module-addons-contrib/,
        /Frontend plugin module/,
        /(\d+)\.(\d+)\.(\d+)/,
      ]);
      // await expect(
      //   page.getByRole("cell", { name: "Techdocs" }).first(),
      // ).toBeVisible();
      // await expect(
      //   page.getByRole("cell", {
      //     name: "backstage-plugin-techdocs-module-addons-contrib",
      //   }),
      // ).toBeVisible();
      // await expect(
      //   page.getByRole("cell", { name: "Frontend plugin module" }),
      // ).toBeVisible();
      // await expect(
      //   page.getByRole("cell", { name: /(\d+)\.(\d+)\.(\d+)/ }),
      // ).toBeVisible();

      // Verify actions column - in production, buttons are disabled with tooltip
      const techdocsRow = page
        .getByRole("row")
        .filter({ hasText: "Techdocs Module Addons Contrib" });

      await expect(techdocsRow).toBeVisible();

      // Wait specifically for the Actions cell (5th cell / last cell) to be rendered
      const actionsCell = techdocsRow.getByRole("cell").last();
      await expect(actionsCell).toBeVisible({ timeout: 15000 });

      // Now wait for the tooltip text to appear in the actions cell
      await expect(actionsCell).toContainText(
        /Package cannot be managed in the production environment/i,
        { timeout: 15000 },
      );
      await page
        .getByRole("button", {
          name: new RegExp(
            `Rows per page: 5 ${t["plugin.extensions"][lang]["table.pagination.rows"]}`,
          ),
        })
        .click();
      await page.getByRole("option", { name: "10", exact: true }).click();
      await page
        .getByRole("button", {
          name: new RegExp(
            `Rows per page: 10 ${t["plugin.extensions"][lang]["table.pagination.rows"]}`,
          ),
        })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", {
          name: new RegExp(
            `Rows per page: 10 ${t["plugin.extensions"][lang]["table.pagination.rows"]}`,
          ),
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Next Page" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Previous Page" }),
      ).toBeVisible();
    });

    test("Topology package sidebar for CI", async ({ page }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2144
      // test.fixme();
      await page
        .getByRole("textbox", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .fill("Topology");
      await expect(
        page.getByRole("cell", { name: "backstage-community-plugin-topology" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row", { name: "Topology backstage-community" })
          .getByTestId("EditIcon"),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row", {
            name: "Topology backstage-community-plugin-topology",
          })
          .getByTestId("FileDownloadOutlinedIcon"),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row", {
            name: "Topology backstage-community-plugin-topology",
          })
          .getByRole("checkbox"),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: "Topology",
        })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Topology",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: t["plugin.extensions"][lang]["actions.view"],
        }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang]["actions.view"],
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
            name: t["plugin.extensions"][lang][
              "installedPackages.table.tooltips.enableActions"
            ],
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
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
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
          name: t["plugin.extensions"][lang]["common.apply"],
        })
        .click();
      await expect(page.getByRole("code")).toContainText(
        "testMode: ${SEGMENT_TEST_MODE}",
      );
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang]["install.reset"],
        })
        .click();
      await expect(page.getByRole("code")).not.toContainText(
        "testMode: ${SEGMENT_TEST_MODE}",
      );
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang]["install.cancel"],
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
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .fill("Analytics provider segment");
      await expect(
        page.getByRole("cell", { name: "Analytics Provider Segment" }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.tooltips.editPackage"
          ],
        })
        .click();
      await uiHelper.verifyHeading(
        t["plugin.extensions"][lang]["install.editInstructions"],
      );
      await expect(page.getByText("SaveCancelReset")).toBeVisible();
      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang]["button.save"],
        })
        .click();
      await uiHelper.verifyHeading(
        new RegExp(
          `^${t["plugin.extensions"][lang]["header.installedPackages"]} \\(\\d+\\)$`,
        ),
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
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .fill("Dynamic Home Page");
      await expect(
        page.getByRole("cell", { name: "Dynamic Home Page" }),
      ).toBeVisible();
      await page.getByRole("checkbox").hover();
      await expect(
        page.getByLabel(
          t["plugin.extensions"][lang][
            "installedPackages.table.tooltips.disablePackage"
          ],
        ),
      ).toBeVisible();
      await page.getByRole("checkbox").click();
      await expect(page.getByRole("alert").first()).toContainText(
        "The red-hat-developer-hub-backstage-plugin-dynamic-home-page package requires a restart of the backend system to finish installing, updating, enabling or disabling.",
        { timeout: 15000 },
      );
      await page
        .getByRole("textbox", {
          name: t["plugin.extensions"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .fill("Global Header");
      await expect(
        page.getByRole("cell", { name: "Global Header" }),
      ).toBeVisible();
      await page.getByRole("checkbox").hover();
      await expect(
        page.getByLabel(
          t["plugin.extensions"][lang][
            "installedPackages.table.tooltips.disablePackage"
          ],
        ),
      ).toBeVisible();
      await page.getByRole("checkbox").click();

      await page
        .getByRole("button", {
          name: t["plugin.extensions"][lang]["alert.viewPackages"],
        })
        .click();
      await expect(
        page
          .getByLabel(
            t["plugin.extensions"][lang]["alert.backendRestartRequired"],
          )
          .getByText(
            t["plugin.extensions"][lang]["alert.backendRestartRequired"],
          ),
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
