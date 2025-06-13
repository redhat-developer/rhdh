import { test } from "@playwright/test";
import { OrchestratorPages } from "../../utils/orchestrator_common/orchestratorPages";
import { createNotification } from "../../utils/common/api";

test("OCP-74287: Mark notification as read @notifications @parallel", async ({ page }) => {
  let r = (Math.random() + 1).toString(36).substring(7);
  await createNotification(
    "entity",
    ["user:default/guest"],
    `UI Notification Mark as read ${r}`,
    `Test UI Notification Mark as read ${r}`,
    "normal",
    `Testing UI Notification Mark as read ${r}`
  );
  const orchestratorPages = new OrchestratorPages(page);
  await orchestratorPages.goto();
  await orchestratorPages.loginAsGuest();
  await orchestratorPages.clickNotificationsNavBarItem();
  await orchestratorPages.clickNotificationsPersonalTab();
  await orchestratorPages.notificationTextExists(
    `UI Notification Mark as read ${r}`
  );
  await orchestratorPages.markNotificationAsRead(`UI Notification Mark as read ${r}`);
  await orchestratorPages.viewRead();
  await orchestratorPages.notificationTextExists(
    RegExp(`UI Notification Mark as read ${r}.*(a few seconds ago)|(a minute ago)`)
  );
});
