import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";

test.describe("Default Global Header", () => {
  let common: Common;
  let uiHelper: UIhelper;

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
    await expect(page.locator(`input[placeholder="Search..."]`)).toBeVisible();
    await uiHelper.verifyLink({ label: "Self-service" });
    await uiHelper.verifyLink({ label: "Support (external link)" });
    await uiHelper.verifyLink({ label: "Notifications" });
    expect(await uiHelper.isBtnVisible("rhdh-qe-2")).toBeTruthy();
  });

  test("Verify that search modal and settings button in sidebar are not visible", async () => {
    expect(await uiHelper.isBtnVisible("Search")).toBeFalsy();
    expect(await uiHelper.isBtnVisible("Settings")).toBeFalsy();
  });

  test("Verify that clicking on Self-service button opens the Software Templates page", async () => {
    await uiHelper.clickLink({ ariaLabel: "Self-service" });
    await uiHelper.verifyHeading("Software Templates");
  });

  test("Verify that clicking on Support button opens a new tab", async ({
    context,
  }) => {
    const [newTab] = await Promise.all([
      context.waitForEvent("page"),
      uiHelper.clickLink({ ariaLabel: "Support (external link)" }),
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
    expect(await uiHelper.isLinkVisible("Settings")).toBeTruthy();
    expect(await uiHelper.isTextVisible("Logout")).toBeTruthy();

    await uiHelper.clickLink({ href: "/settings" });
    await uiHelper.verifyHeading("Settings");

    await uiHelper.openProfileDropdown();
    await page.locator(`p`).getByText("Logout").first().click();
    await uiHelper.verifyHeading("Select a sign-in method");
  });

  test("Verify Search bar behaves as expected", async ({ page }) => {
    const searchBar = page.locator(`input[placeholder="Search..."]`);
    await searchBar.click();
    await searchBar.fill("test query term");
    expect(await uiHelper.isBtnVisibleByTitle("Clear")).toBeTruthy();
    const dropdownList = page.locator(`ul[role="listbox"]`);
    expect(await dropdownList.isVisible()).toBeTruthy();
    await searchBar.press("Enter");
    await uiHelper.verifyHeading("Search");
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
    await uiHelper.clickLink({ ariaLabel: "Notifications" });
    await uiHelper.verifyHeading("Notifications");

    const response = await request.post(`${baseURL}/api/notifications`, {
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

    expect(response.status()).toBe(200);
    const notificationsBadge = page
      .locator("#global-header")
      .getByRole("link", { name: "Notifications" });
    await expect(notificationsBadge).toHaveText("1");
  });
});
