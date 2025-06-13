import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import RhdhNotficationsApi from "../../../support/api/notifications";
import { Notifications } from "../../../support/api/notifications-api-structures";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { NotificationPage } from "../../../support/pages/notifications";

test.describe("Filter normal notification tests", () => {
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

  test("Filter notifications by severity - normal", async () => {
    const r = (Math.random() + 1).toString(36).substring(7);
    const severity = "normal";
    const notificationsApi = await RhdhNotficationsApi.build("test-token");
    // Used broadcast here, but we should use type: entity and entityRef: ["user:<namespace>/<username>"]
    const notification: Notifications = {
      recipients: {
        type: "broadcast",
        entityRef: [""],
      },
      payload: {
        title: `UI Notification Mark all as read ${severity}-${r}`,
        description: `Test UI Notification Mark all as read ${severity}-${r}`,
        severity: severity,
        topic: `Testing UI Notification Mark all as read ${severity}-${r}`,
      },
    };
    await notificationsApi.createNotification(notification);
    await uiHelper.openSidebar("Notifications");
    await notificationPage.selectSeverity("Normal");
    await notificationPage.notificationContains(
      `UI Notification Mark all as read ${severity}-${r}`,
    );
  });
});
