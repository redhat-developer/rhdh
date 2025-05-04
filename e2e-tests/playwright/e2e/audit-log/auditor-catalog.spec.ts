import { test } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { LogUtils } from "./log-utils";
import { CatalogImport } from "../../support/pages/catalog-import";
import { Log } from "./logs";

test.describe("Audit Log check for Scaffold Plugin", () => {
  let uiHelper: UIhelper;
  let common: Common;
  let catalogImport: CatalogImport;
  const template =
    "https://github.com/RoadieHQ/sample-service/blob/main/demo_template.yaml";

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    catalogImport = new CatalogImport(page);
    await common.loginAsGuest();
    await page.goto("/create");
  });

  test("Should fetch logs for entity-mutate event and validate log structure and values", async () => {
    await uiHelper.clickButton("Register Existing Component");
    const isComponentAlreadyRegistered =
      await catalogImport.registerExistingComponent(template, false);

    const expectedEvent = isComponentAlreadyRegistered
      ? {
          eventId: "entity-mutate",
          url: "/api/catalog/refresh",
          method: "POST",
        }
      : {
          eventId: "location-mutate",
          url: "/api/catalog/locations",
          method: "POST",
        };

    const expectedLog: Partial<Log> = {
      eventId: expectedEvent.eventId,
      actor: {
        actorId: "user:development/guest",
      },
      request: {
        method: expectedEvent.method,
        url: expectedEvent.url,
      },
      plugin: "catalog",
      severityLevel: "medium",
      isAuditEvent: true,
      service: "backstage",
    };

    const logLine = await LogUtils.getPodLogsWithRetry(
      [expectedEvent.eventId, expectedEvent.method, expectedEvent.url],
      process.env.NAME_SPACE || "showcase-ci-nightly",
    );

    const actualLog = JSON.parse(logLine);
    LogUtils.validateLog(actualLog, expectedLog);
  });
});
