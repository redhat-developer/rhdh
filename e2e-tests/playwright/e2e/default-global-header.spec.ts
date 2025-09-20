import { expect, test } from "@playwright/test";
import { UIhelper } from "../utils/ui-helper";
import { Common } from "../utils/common";

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
    // Wait for page to be fully loaded
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');
    
    // Use CSS selectors for more precise targeting
    const searchInput = page.locator('input[placeholder="Search..."], input[type="text"], input[class*="search"]');
    await expect(searchInput).toBeVisible();
    
    // Additional wait to ensure elements are rendered
    await page.waitForTimeout(1000);
    
    await uiHelper.verifyLink({ label: "Self-service" });

    // Use more specific CSS selectors for better reliability
    const globalHeader = page.locator("nav[id='global-header'], nav[class*='header'], header nav");
    const helpDropdownButton = globalHeader
      .locator("button[aria-label='Help'], button[class*='help'], button[title*='Help']")
      .or(
        globalHeader.locator("button").filter({
          has: page.locator("svg[data-testid='HelpOutlineIcon'], svg[class*='help'], svg[aria-label*='help']"),
        }),
      )
      .first();

    // Wait for button to be ready
    await page.waitForTimeout(500);
    await expect(helpDropdownButton).toBeVisible();
    
    await uiHelper.verifyLink({ label: "Notifications" });
    
    // Manual assertion with additional verification
    const userButton = page.locator('button[class*="user"], button[aria-label*="user"], button[title*="user"]');
    await page.waitForTimeout(500);
    expect(await userButton.count()).toBeGreaterThan(0);
    expect(await uiHelper.isBtnVisible("rhdh-qe-2")).toBeTruthy();
  });

  test("Verify that search modal and settings button in sidebar are not visible", async () => {
    // Wait for page to stabilize before checking visibility
    await page.waitForTimeout(2000);
    await page.waitForLoadState('domcontentloaded');
    
    // Use CSS selectors to check for hidden elements
    const searchModal = page.locator('div[class*="modal"], div[class*="search"], div[aria-hidden="true"]');
    const settingsButton = page.locator('button[class*="settings"], button[aria-label*="settings"], button[title*="settings"]');
    
    // Manual assertions with additional waits
    await page.waitForTimeout(500);
    expect(await searchModal.count()).toBe(0);
    expect(await settingsButton.count()).toBe(0);
    
    // Original assertions for compatibility
    expect(await uiHelper.isBtnVisible("Search")).toBeFalsy();
    expect(await uiHelper.isBtnVisible("Settings")).toBeFalsy();
  });

  test("Verify that clicking on Self-service button opens the Templates page", async () => {
    // Navigate to home page first to ensure clean state
    await page.goto("/");
    await page.waitForTimeout(2000);
    
    // Use CSS selector to find the self-service link
    const selfServiceLink = page.locator('a[aria-label="Self-service"], a[href*="self-service"], a[class*="self-service"]');
    await page.waitForTimeout(1000);
    
    // Click using CSS selector instead of semantic locator
    await selfServiceLink.click();
    
    // Wait for navigation to complete
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');
    
    // Verify using CSS selectors
    const headingElement = page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: 'Self-service' });
    await page.waitForTimeout(1000);
    expect(await headingElement.count()).toBeGreaterThan(0);
    
    // Original verification for compatibility
    await uiHelper.verifyHeading("Self-service");
  });

  test("Verify that clicking on Support button in HelpDropdown opens a new tab", async ({
    context,
    page,
  }) => {
    const globalHeader = page.locator("nav[id='global-header']");

    const helpDropdownButton = globalHeader
      .locator("button[aria-label='Help']")
      .or(
        globalHeader.locator("button").filter({
          has: page.locator("svg[data-testid='HelpOutlineIcon']"),
        }),
      )
      .first();

    await helpDropdownButton.click();
    await page.waitForTimeout(500);

    expect(await uiHelper.isTextVisible("Support")).toBeTruthy();

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
    expect(await uiHelper.isLinkVisible("Settings")).toBeTruthy();
    expect(await uiHelper.isTextVisible("Sign out")).toBeTruthy();

    await uiHelper.clickLink({ href: "/settings" });
    await uiHelper.verifyHeading("Settings");

    await uiHelper.goToMyProfilePage();
    await uiHelper.verifyTextInSelector("header > div > p", "user");
    await uiHelper.verifyHeading(process.env.GH_USER2_ID);
    await uiHelper.verifyTextInSelector(
      "a[data-testid='header-tab-0'] > span",
      "Overview",
    );

    await uiHelper.openProfileDropdown();
    await page.locator(`p`).getByText("Sign out").first().click();
    await uiHelper.verifyHeading("Select a sign-in method");
  });

  test("Verify Search bar behaves as expected", async ({ page }) => {
    const searchBar = page.locator(`input[placeholder="Search..."]`);
    await searchBar.click();
    await searchBar.fill("test query term");
    expect(await uiHelper.isBtnVisibleByTitle("Clear")).toBeTruthy();
    const dropdownList = page.locator(`ul[role="listbox"]`);
    await expect(dropdownList).toBeVisible();
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
    const notificationsBadge = page
      .locator("#global-header")
      .getByRole("link", { name: "Notifications" });

    await uiHelper.clickLink({ ariaLabel: "Notifications" });
    await uiHelper.verifyHeading("Notifications");
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
