import { expect, test } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

test.describe("Test Object Type Support in ui:props (orchestrator workflow)", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP));
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE));
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.AKS));
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.EKS));
  test.fixme(() => skipIfJobName(JOB_NAME_PATTERNS.OPERATOR));

  let common: Common;
  let uiHelper: UIhelper;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsKeycloakUser();
  });

  test("ui:props test workflow", async ({ page }) => {
    await uiHelper.openSidebar("Orchestrator");
    await expect(
      page.getByRole("cell", { name: "Test Object Type Support" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: /Test Object Type Support in ui:props/i })
      .click();
    await page
      .getByRole("button", { name: "Run", exact: true })
      .first()
      .click();
    await page.getByRole("textbox", { name: "Name" }).fill("test-name");
    await page.getByRole("textbox", { name: "Email" }).click();
    await page.getByRole("textbox", { name: "Email" }).fill("test@test.com");
    await page.getByRole("button", { name: "Next" }).click();
    await page
      .getByRole("textbox", { name: "Simple Text Field" })
      .fill("sample testing");
    await page.getByRole("textbox", { name: "Object Type Example" }).click();
    await page
      .getByRole("textbox", { name: "Object Type Example" })
      .fill('{"kind":"demo","id":42,"tags":["a","b"]}');
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Run workflow")).toBeVisible();
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("Run status Completed")).toBeVisible();
    await expect(page.getByText("ResultsRun completed")).toBeVisible();
    await expect(page.getByText("WorkflowTest object type")).toBeVisible();
    await expect(page.getByText("Workflow Status Available")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run ID" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Duration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Started" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Description" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "View variables" }).click();
    await expect(page.getByText('{ "name": "test-name", "email')).toBeVisible();
    await expect(page.getByText('{ "simpleText": "sample')).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Run Variables close" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
  });
});
