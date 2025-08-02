import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import RhdhNotificationsApi from "../../../support/api/notifications";
import { Notifications } from "../../../support/api/notifications-api-structures";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { NotificationPage } from "../../../support/pages/notifications";

test.describe("Mark notification tests", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;
  let notificationPage: NotificationPage;
  let apiToken: string;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    notificationPage = new NotificationPage(page);
    await common.loginAsKeycloakUser();
    apiToken = await RhdhAuthApiHack.getToken(page);
    console.log(`apiToken -> ${apiToken}`)
  });

  test("Mark notification as read", async () => {
    const r = (Math.random() + 1).toString(36).substring(7);
    const notificationsApi = await RhdhNotificationsApi.build(apiToken);
    const notificationTitle = `UI Notification Mark as read ${r}`
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: notificationTitle,
        description: `Test ${notificationTitle}`,
        severity: "normal",
        topic: `Testing ${notificationTitle}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await uiHelper.openSidebar("Notifications");
    await notificationPage.notificationTextExists(notificationTitle);
    await notificationPage.markNotificationAsRead(notificationTitle);
    await notificationPage.viewRead();
    await notificationPage.notificationTextExists(
      RegExp(`${notificationTitle}.*(a few seconds ago)|(a minute ago)`)
    );
  });

  test("Mark notification as unread", async () => {
    const r = (Math.random() + 1).toString(36).substring(7);
    const notificationsApi = await RhdhNotificationsApi.build(apiToken);
    const notificationTitle = `UI Notification Mark as unread ${r}`
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: notificationTitle,
        description: `Test ${notificationTitle}`,
        severity: "normal",
        topic: `Testing ${notificationTitle}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await uiHelper.openSidebar("Notifications");
    await notificationPage.notificationTextExists(notificationTitle);
    await notificationPage.markNotificationAsRead(notificationTitle);
    await notificationPage.viewRead();
    await notificationPage.notificationTextExists(
      RegExp(`${notificationTitle}.*(a few seconds ago)|(a minute ago)`)
    );
    await notificationPage.markLastNotificationAsUnRead();
    await notificationPage.viewUnRead();
    await notificationPage.notificationTextExists(
      RegExp(`${notificationTitle}.*(a few seconds ago)|(a minute ago)`)
    );
  });

  test("Mark notification as saved", async () => {
    const r = (Math.random() + 1).toString(36).substring(7);
    const notificationsApi = await RhdhNotificationsApi.build(apiToken);
    const notificationTitle = `UI Notification Mark as saved ${r}`
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: notificationTitle,
        description: `Test ${notificationTitle}`,
        severity: "normal",
        topic: `Testing ${notificationTitle}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await uiHelper.openSidebar("Notifications");
    await notificationPage.selectNotification();
    await notificationPage.saveSelected();
    await notificationPage.viewSaved();
    await notificationPage.notificationTextExists(
      RegExp(`${notificationTitle}.*(a few seconds ago)|(a minute ago)`)
    );
  });
});