import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";
import {
  getTranslations,
  getCurrentLanguage,
} from "../e2e/localization/locale";

const t = getTranslations();
const lang = getCurrentLanguage();

test.describe("Default Global Header", () => {
  let common: Common;
  let uiHelper: UIhelper;

  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "navigation",
    });
  });

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    await common.loginAsKeycloakUser(
      process.env.GH_USER2_ID,
      process.env.GH_USER2_PASS,
    );
    await expect(page.getByRole("navigation").first()).toBeVisible();
  });

  test("Verify that global header and default header components are visible", async ({
    page,
  }) => {
    await expect(
      page.getByPlaceholder(
        t["plugin.global-header"][lang]["search.placeholder"],
      ),
    ).toBeVisible();
    await uiHelper.verifyLink({
      // TODO: RHDHBUGS-2564 - String not getting translated
      // label: t["rhdh"][lang]["menuItem.selfService"],
      label: "Self-service",
    });

    const globalHeader = page.getByRole("navigation").first();
    const helpDropdownButton = globalHeader
      .getByRole("button", {
        name: t["plugin.global-header"][lang]["help.tooltip"],
      })
      .or(
        globalHeader.getByRole("button").filter({
          has: page.getByTestId("HelpOutlineIcon"),
        }),
      )
      .first();

    await expect(helpDropdownButton).toBeVisible();
    await uiHelper.verifyLink({
      label: t["plugin.global-header"][lang]["notifications.title"],
    });
    expect(await uiHelper.isBtnVisible("rhdh-qe-2")).toBeTruthy();
  });

  test("Verify that search modal and settings button in sidebar are not visible", async () => {
    expect(
      await uiHelper.isBtnVisible(t["rhdh"][lang]["app.search.title"]),
    ).toBeFalsy();
    expect(
      await uiHelper.isBtnVisible(t["user-settings"][lang]["sidebarTitle"]),
    ).toBeFalsy();
  });

  test("Verify that clicking on Self-service button opens the Templates page", async () => {
    await uiHelper.goToSelfServicePage();
  });

  test("Verify that clicking on Support button in HelpDropdown opens a new tab", async ({
    context,
    page,
  }) => {
    const globalHeader = page.getByRole("navigation").first();

    const helpDropdownButton = globalHeader
      .getByRole("button", {
        name: t["plugin.global-header"][lang]["help.tooltip"],
      })
      .or(
        globalHeader.getByRole("button").filter({
          has: page.getByTestId("HelpOutlineIcon"),
        }),
      )
      .first();

    await helpDropdownButton.click();
    await page.waitForTimeout(500);

    await uiHelper.verifyTextVisible(
      t["plugin.global-header"][lang]["help.supportTitle"],
      true,
    );

    const [newTab] = await Promise.all([
      context.waitForEvent("page"),
      uiHelper.clickByDataTestId("support-button"),
    ]);

    expect(newTab).not.toBeNull();
    await newTab.waitForLoadState();
    expect(newTab.url()).toContain(
      "https://github.com/redhat-developer/rhdh/issues",
    );
    await newTab.close();
  });

  test("Verify Profile Dropdown behaves as expected", async ({ page }) => {
    await uiHelper.openProfileDropdown();
    await uiHelper.verifyLinkVisible(
      // TODO: RHDHBUGS-2552 - Strings not getting translated
      // t["plugin.global-header"][lang]["profile.settings"],
      "Settings",
    );
    await uiHelper.verifyTextVisible(
      t["plugin.global-header"][lang]["profile.signOut"],
    );

    await page
      .getByRole("menuitem", {
        // TODO: RHDHBUGS-2552 - Strings not getting translated
        // t["plugin.global-header"][lang]["profile.settings"],
        name: "Settings",
      })
      .click();
    await uiHelper.verifyHeading(
      t["user-settings"][lang]["settingsLayout.title"],
    );

    await uiHelper.goToMyProfilePage();
    await uiHelper.verifyTextInSelector("header > div > p", "user");
    await uiHelper.verifyHeading(process.env.GH_USER2_ID);
    await expect(
      page.getByRole("tab", {
        name: t["rhdh"][lang]["catalog.entityPage.overview.title"],
      }),
    ).toBeVisible();

    await uiHelper.openProfileDropdown();
    // Scope sign-out search to the profile menu (role=menu)
    await page
      .getByRole("menu")
      .getByText(t["plugin.global-header"][lang]["profile.signOut"])
      .click();
    await uiHelper.verifyHeading(t["rhdh"][lang]["signIn.page.title"]);
  });

  test("Verify Search bar behaves as expected", async ({ page }) => {
    const searchBar = page.getByPlaceholder(
      t["plugin.global-header"][lang]["search.placeholder"],
    );
    await searchBar.click();
    await searchBar.fill("test query term");
    expect(await uiHelper.isBtnVisibleByTitle("Clear")).toBeTruthy();
    const dropdownList = page.getByRole("listbox");
    await expect(dropdownList).toBeVisible();
    await searchBar.press("Enter");
    await uiHelper.verifyHeading(t["rhdh"][lang]["app.search.title"]);
    // eslint-disable-next-line playwright/no-raw-locators
    const searchResultPageInput = page.locator("#search-bar-text-field");
    await expect(searchResultPageInput).toHaveValue("test query term");
  });

  test("Verify Notifications button behaves as expected", async ({
    baseURL,
    request,
    page,
  }) => {
    const notificationsBadge = page
      .getByRole("navigation")
      .first()
      .getByRole("link", {
        name: t["plugin.global-header"][lang]["notifications.title"],
      });

    await uiHelper.clickLink({
      ariaLabel: t["plugin.global-header"][lang]["notifications.title"],
    });
    await uiHelper.verifyHeading(
      // TODO: RHDHBUGS-2585 - String not getting translated
      // t["plugin.global-header"][lang]["notifications.title"],
      "Notifications",
    );
    await uiHelper.markAllNotificationsAsReadIfVisible();

    const postResponse = await request.post(`${baseURL}/api/notifications`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      data: {
        recipients: { type: "broadcast" },
        payload: {
          title: "Demo test notification message!",
          link: "http://foo.com/bar",
          severity: "high",
          topic: "The topic",
        },
      },
    });
    expect(postResponse.status()).toBe(200);

    await expect(notificationsBadge).toHaveText("1");
  });
});
