import { test } from "@playwright/test";
import { OrchestratorPages } from "../../utils/orchestrator_common/orchestratorPages";
import { createNotification } from "../../utils/common/api";

test("OCP-74573: Implement filter on Saved - https://issues.redhat.com/browse/FLPATH-1001 @notifications @parallel", async ({
  page,
}) => {
  let r = (Math.random() + 1).toString(36).substring(7);
  await createNotification(
    "entity",
    ["user:default/guest"],
    `UI Notification save selected ${r}`,
    `Test UI Notification save selected ${r}`,
    "normal",
    `Testing UI Notification save selected ${r}`
  );
  const orchestratorPages = new OrchestratorPages(page);
  await orchestratorPages.goto();
  await orchestratorPages.loginAsGuest();
  await orchestratorPages.clickNotificationsNavBarItem();
  await orchestratorPages.selectNotification();
  await orchestratorPages.saveSelected();
  await orchestratorPages.viewSaved();
  await orchestratorPages.notificationContains(
    RegExp(
      `UI Notification save selected ${r}.*(a few seconds ago)|(a minute ago)`
    )
  );
});
