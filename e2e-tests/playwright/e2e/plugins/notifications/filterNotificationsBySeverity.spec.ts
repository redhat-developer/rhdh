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

  let severities = ["Critical", "High", "Normal", "Low"];

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    notificationPage = new NotificationPage(page);
    await common.loginAsKeycloakUser();
    apiToken = await RhdhAuthApiHack.getToken(page);
    console.log(`apiToken -> ${apiToken}`)
  });

  for (const severity of severities) {
    test(`Filter notifications by severity - ${severity}`, async () => {
      const r = (Math.random() + 1).toString(36).substring(7);
      const notificationsApi = await RhdhNotficationsApi.build(apiToken);
      const notificationTitle = "UI Notification By Severity"
      // Used broadcast here, but we should use type: entity and entityRef: ["user:<namespace>/<username>"]
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
      await uiHelper.openSidebar("Notifications");
      await notificationPage.selectSeverity(severity);
      await notificationPage.notificationContains(
        `${notificationTitle} ${severity}-${r}`,
      );
    });
  }
});
