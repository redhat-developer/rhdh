import { test } from "@playwright/test";
import { OrchestratorPages } from "../../utils/orchestrator_common/orchestratorPages";
import { createNotification } from "../../utils/common/api";

test("OCP-74288: Mark notification as un-read @notifications @parallel", async ({ page }) => {
  let r = (Math.random() + 1).toString(36).substring(7);
  await createNotification(
    "entity",
    ["user:default/guest"],
    `UI Notification Mark as unread - ${r}`,
    `Test UI Notification Mark as unread - ${r}`,
    "normal",
    `Testing UI Notification Mark as unread - ${r}`
  );
  const orchestratorPages = new OrchestratorPages(page);
  await orchestratorPages.goto();
  await orchestratorPages.loginAsGuest();
  await orchestratorPages.clickNotificationsNavBarItem();
  await orchestratorPages.clickNotificationsPersonalTab();
  await orchestratorPages.notificationContains(
    `UI Notification Mark as unread - ${r}`
  );
  await orchestratorPages.markLastNotificationAsRead();
  await orchestratorPages.viewRead();
  await orchestratorPages.notificationContains(
    `UI Notification Mark as unread - ${r}`
  );
  await orchestratorPages.markLastNotificationAsUnRead();
  await orchestratorPages.viewUnRead();
  await orchestratorPages.notificationContains(
    `UI Notification Mark as unread - ${r}`
  );
});
