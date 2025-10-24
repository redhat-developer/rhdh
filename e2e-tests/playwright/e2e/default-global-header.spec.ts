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
    await expect(page.locator("nav[id='global-header']")).toBeVisible();
  });

  test("Verify that global header and default header components are visible", async ({
    page,
  }) => {
    await expect(
      page.locator(
        `input[placeholder="${t["plugin.global-header"][lang]["search.placeholder"]}"]`,
      ),
    ).toBeVisible();
    await uiHelper.verifyLink({
      label: t["rhdh"][lang]["menuItem.selfService"],
    });

    const globalHeader = page.locator("nav[id='global-header']");
    const helpDropdownButton = globalHeader
      .locator(
        `button[aria-label='${t["plugin.global-header"][lang]["help.tooltip"]}']`,
      )
      .or(
        globalHeader.locator("button").filter({
          has: page.locator("svg[data-testid='HelpOutlineIcon']"),
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
    await uiHelper.clickLink({
      ariaLabel: t["rhdh"][lang]["menuItem.selfService"],
    });
    await uiHelper.verifyHeading(t["rhdh"][lang]["menuItem.selfService"]);
  });

  test("Verify that clicking on Support button in HelpDropdown opens a new tab", async ({
    context,
    page,
  }) => {
    const globalHeader = page.locator("nav[id='global-header']");

    const helpDropdownButton = globalHeader
      .locator(
        `button[aria-label='${t["plugin.global-header"][lang]["help.tooltip"]}']`,
      )
      .or(
        globalHeader.locator("button").filter({
          has: page.locator("svg[data-testid='HelpOutlineIcon']"),
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
      t["user-settings"][lang]["settingsLayout.title"],
    );
    await uiHelper.verifyTextVisible(
      t["plugin.global-header"][lang]["profile.signOut"],
    );

    await page
      .getByRole("menuitem", {
        name: t["user-settings"][lang]["settingsLayout.title"],
      })
      .click();
    await uiHelper.verifyHeading(
      t["user-settings"][lang]["settingsLayout.title"],
    );

    await uiHelper.goToMyProfilePage();
    await uiHelper.verifyTextInSelector("header > div > p", "user");
    await uiHelper.verifyHeading(process.env.GH_USER2_ID);
    await expect(page.getByTestId("header-tab-0")).toHaveText("Overview");

    await uiHelper.openProfileDropdown();
    await page
      .locator(`p`)
      .getByText(t["plugin.global-header"][lang]["profile.signOut"])
      .first()
      .click();
    await uiHelper.verifyHeading(t["rhdh"][lang]["signIn.page.title"]);
  });

  test("Verify Search bar behaves as expected", async ({ page }) => {
    const searchBar = page.locator(
      `input[placeholder="${t["plugin.global-header"][lang]["search.placeholder"]}"]`,
    );
    await searchBar.click();
    await searchBar.fill("test query term");
    expect(await uiHelper.isBtnVisibleByTitle("Clear")).toBeTruthy();
    const dropdownList = page.locator(`ul[role="listbox"]`);
    await expect(dropdownList).toBeVisible();
    await searchBar.press("Enter");
    await uiHelper.verifyHeading(t["rhdh"][lang]["app.search.title"]);
    const searchResultPageInput = page.locator(
      `input[id="search-bar-text-field"]`,
    );
    await expect(searchResultPageInput).toHaveValue("test query term");
  });

  test("Verify Notifications button behaves as expected", async ({
    baseURL,
    request,
    page,
  }) => {
    const notificationsBadge = page
      .locator("#global-header")
      .getByRole("link", {
        name: t["plugin.global-header"][lang]["notifications.title"],
      });

    await uiHelper.clickLink({
      ariaLabel: t["plugin.global-header"][lang]["notifications.title"],
    });
    await uiHelper.verifyHeading(
      t["plugin.global-header"][lang]["notifications.title"],
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
