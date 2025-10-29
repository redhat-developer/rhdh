import { test } from "@playwright/test";
import { Common } from "../../../utils/common";
import RhdhNotificationsApi from "../../../support/api/notifications";
import { Notifications } from "../../../support/api/notifications-api-structures";
import { NotificationPage } from "../../../support/pages/notifications";

test.describe("Mark notification tests", () => {
  let common: Common;
  let notificationPage: NotificationPage;
  let apiToken: string;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    notificationPage = new NotificationPage(page);
    await common.loginAsKeycloakUser();
    apiToken = "test-token";
  });

  test("Mark notification as read", async () => {
    const r = crypto.randomUUID();
    const notificationsApi = await RhdhNotificationsApi.build(apiToken);
    const notificationTitle = `UI Notification Mark as read`;
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: `${notificationTitle}-${r}`,
        description: `Test ${notificationTitle}-${r}`,
        severity: "Normal",
        topic: `Testing ${notificationTitle}-${r}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await notificationPage.clickNotificationsNavBarItem();
    await notificationPage.notificationContains(`${notificationTitle}-${r}`);
    await notificationPage.markNotificationAsRead(`${notificationTitle}-${r}`);
    await notificationPage.viewRead();
    await notificationPage.notificationContains(
      RegExp(`${notificationTitle}-${r}.*(a few seconds ago)|(a minute ago)`),
    );
  });

  test("Mark notification as unread", async () => {
    const r = crypto.randomUUID();
    const notificationsApi = await RhdhNotificationsApi.build(apiToken);
    const notificationTitle = `UI Notification Mark as unread`;
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: `${notificationTitle}-${r}`,
        description: `Test ${notificationTitle}-${r}`,
        severity: "Normal",
        topic: `Testing ${notificationTitle}-${r}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await notificationPage.clickNotificationsNavBarItem();
    await notificationPage.notificationContains(`${notificationTitle}-${r}`);
    await notificationPage.markNotificationAsRead(`${notificationTitle}-${r}`);
    await notificationPage.viewRead();
    await notificationPage.notificationContains(
      RegExp(`${notificationTitle}-${r}.*(a few seconds ago)|(a minute ago)`),
    );
    await notificationPage.markLastNotificationAsUnRead();
    await notificationPage.viewUnRead();
    await notificationPage.notificationContains(
      RegExp(`${notificationTitle}-${r}.*(a few seconds ago)|(a minute ago)`),
    );
  });

  test("Mark notification as saved", async () => {
    const r = crypto.randomUUID();
    const notificationsApi = await RhdhNotificationsApi.build(apiToken);
    const notificationTitle = `UI Notification Mark as saved`;
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: `${notificationTitle}-${r}`,
        description: `Test ${notificationTitle}-${r}`,
        severity: "Normal",
        topic: `Testing ${notificationTitle}-${r}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await notificationPage.clickNotificationsNavBarItem();
    await notificationPage.selectNotification();
    await notificationPage.saveSelected();
    await notificationPage.viewSaved();
    await notificationPage.notificationContains(
      RegExp(`${notificationTitle}-${r}.*(a few seconds ago)|(a minute ago)`),
    );
  });
});
