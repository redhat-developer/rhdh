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
    // TODO: Custom plugin is not on the list: https://issues.redhat.com/browse/RHDHBUGS-2153
    // t["plugin.marketplace"][lang]["badges.customPlugin"],
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

  test.describe("Extensions > Catalog", () => {
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

      await uiHelper.clickTab(t["plugin.marketplace"][lang]["header.catalog"]);
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
      await uiHelper.clickLink(
        t["plugin.marketplace"][lang]["common.readMore"],
      );
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
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      test.fixme();
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
      await uiHelper.clickLink(
        t["plugin.marketplace"][lang]["common.readMore"],
      );
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
      await uiHelper.verifyText(
        t["plugin.marketplace"][lang]["metadata.about"],
      );
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

      await uiHelper.clickLink(
        t["plugin.marketplace"][lang]["common.readMore"],
      );
      await expect(
        page
          .getByLabel(
            t["plugin.marketplace"][lang]["badges.productionReadyBy"].replace(
              "{{provider}}",
              "Red Hat",
            ),
          )
          .getByText(
            t["plugin.marketplace"][lang]["badges.generallyAvailable"],
          ),
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

    test("Verify custom plugin badge in extensions", async ({ page }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2104
      test.fixme();
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
      await uiHelper.clickLink(
        t["plugin.marketplace"][lang]["common.readMore"],
      );
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
          .getByLabel(
            t["plugin.marketplace"][lang]["badges.openSourceNoSupport"],
          )
          .getByText(t["plugin.marketplace"][lang]["badges.communityPlugin"]),
      ).toBeVisible();

      await uiHelper.verifyText(
        t["plugin.marketplace"][lang]["metadata.about"],
      );
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

    test("Verify plugin configuration can be viewed in the production environment", async ({
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
      await extensions.waitForSearchResults("Topology");
      await extensions.clickReadMoreByPluginTitle("Topology");
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
      await uiHelper.clickTab(
        t["plugin.marketplace"][lang]["install.examples"],
      );
      await uiHelper.clickByDataTestId("ContentCopyRoundedIcon");
      await expect(page.getByRole("button", { name: "✔" })).toBeVisible();
      await uiHelper.clickButton(
        t["plugin.marketplace"][lang]["install.reset"],
      );
      await expect(page.getByText("pluginConfig:")).toBeHidden();
      // eslint-disable-next-line playwright/no-conditional-in-test
      const modifier = isMac ? "Meta" : "Control";
      await page.keyboard.press(`${modifier}+KeyA`);
      await page.keyboard.press(`${modifier}+KeyV`);
      await uiHelper.verifyText("pluginConfig:");
      await page.locator("button[class^='copy-button']").nth(0).click();
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
      await uiHelper.clickButton(t["plugin.marketplace"][lang]["install.back"]);
      await expect(
        page.getByRole("button", {
          name: t["plugin.marketplace"][lang]["actions.view"],
        }),
      ).toBeVisible();
      await uiHelper.verifyHeading("Application Topology for Kubernetes");
    });

    //Following test is disabled for CI as plugin installation is disabled in CI
    test("Enable plugin from catalog extension page", async ({ page }) => {
      // TODO: https://issues.redhat.com/browse/RHDHBUGS-2146
      test.fixme();
      await uiHelper.clickTab(
        t["plugin.marketplace"][lang]["menuItem.catalog"],
      );
      await extensions.clickReadMoreByPluginTitle(
        "Adoption Insights for Red Hat Developer Hub",
      );
      await uiHelper.verifyHeading("Adoption Insights for Red Hat");
      await page.getByTestId("plugin-actions").click();
      await expect(page.getByLabel("EditPlugin")).toBeVisible();
      await page.getByTestId("disable-plugin").click();
      const alertText = await page.getByRole("alert").first().textContent();
      expect(alertText).toContain(
        t["plugin.marketplace"][lang]["alert.backendRestartRequired"],
      );
      expect(alertText).toContain(
        "The Adoption Insights for Red Hat Developer Hub plugin requires a restart of the backend system to finish installing, updating, enabling or disabling.",
      );
    });
  });

  test.describe("Extensions > Installed Plugin", () => {
    test.beforeEach(async () => {
      await uiHelper.clickTab(
        t["plugin.marketplace"][lang]["header.installedPackages"],
      );
      await uiHelper.verifyHeading(
        new RegExp(
          `^${t["plugin.marketplace"][lang]["header.installedPackages"]} \\(\\d+\\)$`,
        ),
      );
    });

    test("Installed packages page", async ({ page }, testInfo) => {
      await runAccessibilityTests(page, testInfo);
      await uiHelper.verifyTableHeadingAndRows([
        t["plugin.marketplace"][lang]["installedPackages.table.columns.name"],
        t["plugin.marketplace"][lang][
          "installedPackages.table.columns.packageName"
        ],
        t["plugin.marketplace"][lang]["installedPackages.table.columns.role"],
        t["plugin.marketplace"][lang][
          "installedPackages.table.columns.version"
        ],
        t["plugin.marketplace"][lang][
          "installedPackages.table.columns.actions"
        ],
      ]);
      await page.waitForTimeout(2000);
      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.columns.name"
          ],
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("cell", { name: "Techdocs" }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", {
          name: "backstage-plugin-techdocs-module-addons-contrib",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "Frontend plugin module" }),
      ).toBeVisible();
      await expect(page.getByRole("cell", { name: "1.1.27" })).toBeVisible();
      await expect(
        page.locator(".v5-MuiBox-root.css-1i27l4i").first(),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: new RegExp(
            `Rows per page: 5 ${t["plugin.marketplace"][lang]["table.pagination.rows"]}`,
          ),
        })
        .click();
      await page.getByRole("option", { name: "10", exact: true }).click();
      await page
        .locator("div")
        .getByRole("button", {
          name: new RegExp(
            `Rows per page: 10 ${t["plugin.marketplace"][lang]["table.pagination.rows"]}`,
          ),
        })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", {
          name: new RegExp(
            `Rows per page: 10 ${t["plugin.marketplace"][lang]["table.pagination.rows"]}`,
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
      test.fixme();
      await page
        .getByRole("textbox", {
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.marketplace"][lang][
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
          name: t["plugin.marketplace"][lang]["actions.view"],
        }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang]["actions.view"],
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
            name: t["plugin.marketplace"][lang][
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
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.marketplace"][lang][
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
          name: t["plugin.marketplace"][lang]["common.apply"],
        })
        .click();
      await expect(
        page.locator(
          '.v5-MuiCardContent-root [data-mode-id="yaml"] [role="code"]',
        ),
      ).toContainText("testMode: ${SEGMENT_TEST_MODE}");
      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang]["install.reset"],
        })
        .click();
      await expect(
        page.locator(
          '.v5-MuiCardContent-root [data-mode-id="yaml"] [role="code"]',
        ),
      ).not.toContainText("testMode: ${SEGMENT_TEST_MODE}");
      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang]["install.cancel"],
        })
        .click();
      await expect(
        page
          .locator("div")
          .filter({ hasText: "Analytics Provider Segmentby" })
          .nth(4),
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
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .fill("Analytics provider segment");
      await expect(
        page.getByRole("cell", { name: "Analytics Provider Segment" }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.tooltips.editPackage"
          ],
        })
        .click();
      await uiHelper.verifyHeading(
        t["plugin.marketplace"][lang]["install.editInstructions"],
      );
      await expect(page.getByText("SaveCancelReset")).toBeVisible();
      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang]["button.save"],
        })
        .click();
      await uiHelper.verifyHeading(
        new RegExp(
          `^${t["plugin.marketplace"][lang]["header.installedPackages"]} \\(\\d+\\)$`,
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
          name: t["plugin.marketplace"][lang][
            "installedPackages.table.searchPlaceholder"
          ],
        })
        .click();
      await page
        .getByRole("textbox", {
          name: t["plugin.marketplace"][lang][
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
          t["plugin.marketplace"][lang][
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
          name: t["plugin.marketplace"][lang][
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
          t["plugin.marketplace"][lang][
            "installedPackages.table.tooltips.disablePackage"
          ],
        ),
      ).toBeVisible();
      await page.getByRole("checkbox").click();

      await page
        .getByRole("button", {
          name: t["plugin.marketplace"][lang]["alert.viewPackages"],
        })
        .click();
      await expect(
        page
          .getByLabel(
            t["plugin.marketplace"][lang]["alert.backendRestartRequired"],
          )
          .getByText(
            t["plugin.marketplace"][lang]["alert.backendRestartRequired"],
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
