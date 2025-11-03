import { expect, type Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

export class NotificationPage {
  private readonly page: Page;
  private readonly uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async clickNotificationsNavBarItem() {
    await this.uiHelper.openSidebar("Notifications");
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async notificationContains(text: string | RegExp) {
    await this.page.getByLabel(/.*rows/).click();
    // always expand the notifications table to show as many notifications as possible
    await this.page.getByRole("option", { name: "20" }).click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
    const row = this.page.locator(`tr`, { hasText: text }).first();
    await expect(row).toHaveCount(1);
  }

  async clickNotificationHeadingLink(text: string | RegExp) {
    await this.page
      .getByRole("cell", { name: text, exact: true })
      .first()
      .getByRole("heading")
      .click();
  }
  async markAllNotificationsAsRead() {
    const markAllNotificationsAsReadIsVisible = await this.page
      .getByTitle("Mark all read")
      .getByRole("button")
      .isVisible();
    console.log(markAllNotificationsAsReadIsVisible);
    // If button isn't visible there are no records in the notification table
    if (markAllNotificationsAsReadIsVisible.toString() != "false") {
      await this.page.getByTitle("Mark all read").getByRole("button").click();
      await this.page.getByRole("button", { name: "MARK ALL" }).click();
      await expect(
        this.page.getByTestId("loading-indicator").getByRole("img"),
      ).toHaveCount(0);
      await expect(this.page.getByText("No records to display")).toBeVisible();
    }
  }

  async selectAllNotifications() {
    await this.page.getByRole("checkbox").first().click();
  }

  async selectNotification(nth = 1) {
    await this.page.getByRole("checkbox").nth(nth).click();
  }

  async selectSeverity(severity = "") {
    await this.page.getByLabel("Severity").click();
    await this.page.getByRole("option", { name: severity }).click();
    await expect(
      this.page.getByRole("table").filter({ hasText: "Rows per page" }),
    ).toBeVisible();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async saveSelected() {
    await this.page
      .locator("thead")
      .getByTitle("Save selected for later")
      .getByRole("button")
      .click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async saveAllSelected() {
    await this.page
      .locator("thead")
      .getByTitle("Save selected for later")
      .getByRole("button")
      .click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async viewSaved() {
    await this.page.getByLabel("View").click();
    await this.page.getByRole("option", { name: "Saved" }).click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async markLastNotificationAsRead() {
    const row = this.page.locator("td:nth-child(3) > div").first();
    await row.getByRole("button").nth(1).click();
  }

  async markNotificationAsRead(text: string) {
    const row = this.page.locator(`tr:has-text("${text}")`);
    await row.getByRole("button").nth(1).click();
  }

  async markLastNotificationAsUnRead() {
    const row = this.page.locator("td:nth-child(3) > div").first();
    await row.getByRole("button").nth(1).click();
  }

  async viewRead() {
    await this.page.getByLabel("View").click();
    await this.page
      .getByRole("option", { name: "Read notifications", exact: true })
      .click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async viewUnRead() {
    await this.page.getByLabel("View").click();
    await this.page
      .getByRole("option", { name: "Unread notifications", exact: true })
      .click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async sortByOldestOnTop() {
    await this.page.getByLabel("Sort by").click();
    await this.page.getByRole("option", { name: "Oldest on top" }).click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }

  async sortByNewestOnTop() {
    await this.page.getByLabel("Sort by").click();
    await this.page.getByRole("option", { name: "Newest on top" }).click();
    await expect(
      this.page.getByTestId("loading-indicator").getByRole("img"),
    ).toHaveCount(0);
  }
}
