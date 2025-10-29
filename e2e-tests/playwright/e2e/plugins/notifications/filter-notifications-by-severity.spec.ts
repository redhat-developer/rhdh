import { test } from "@playwright/test";
import { Common } from "../../../utils/common";
import RhdhNotificationsApi from "../../../support/api/notifications";
import { Notifications } from "../../../support/api/notifications-api-structures";
import { NotificationPage } from "../../../support/pages/notifications";

test.describe("Filter critical notification tests", () => {
  let common: Common;
  let notificationPage: NotificationPage;
  let apiToken: string;

  const severities = ["Critical", "High", "Normal", "Low"];

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    notificationPage = new NotificationPage(page);
    await common.loginAsKeycloakUser();
    apiToken = "test-token";
  });

  for (const severity of severities) {
    test(`Filter notifications by severity - ${severity}`, async () => {
      const r = crypto.randomUUID();
      const notificationsApi = await RhdhNotificationsApi.build(apiToken);
      const notificationTitle = "UI Notification By Severity";
      const notification: Notifications = {
        recipients: {
          type: "broadcast",
          entityRef: [""],
        },
        payload: {
          title: `${notificationTitle} ${severity}-${r}`,
          description: `Test ${notificationTitle} ${severity}-${r}`,
          severity: severity,
          topic: `Testing ${notificationTitle} ${severity}-${r}`,
        },
      };
      await notificationsApi.createNotification(notification);
      await notificationPage.clickNotificationsNavBarItem();
      await notificationPage.selectSeverity(severity);
      await notificationPage.notificationContains(
        `${notificationTitle} ${severity}-${r}`,
      );
    });
  }
});
