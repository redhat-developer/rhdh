import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import RhdhNotficationsApi from "../../../support/api/notifications";
import { Notifications } from "../../../support/api/notifications-api-structures";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { NotificationPage } from "../../../support/pages/notifications";

test.describe("Filter critical notification tests", () => {
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
  });

  test("Fiter notifcations by serverity - critical", async () => {
    let r = (Math.random() + 1).toString(36).substring(7);
    let severity = "critical";
    const notificationsApi = await RhdhNotficationsApi.build("test-token");
    // Used boradcast here, but we should use type: entity and entityRef: ["user:<namespace>/<username>"]
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
    await notificationPage.selectSeverity("Critical");
    await notificationPage.notificationContains(
      `UI Notification Mark all as read ${severity}-${r}`,
    );
  });
});
