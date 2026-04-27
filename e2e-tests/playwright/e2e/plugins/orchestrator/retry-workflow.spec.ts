import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Common } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

function jsonOk(value: string) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  };
}

test.describe("RHIDP-12877 Sample Retry Test — ActiveTextInput fetch retries", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP));
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE));
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.AKS));
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.EKS));
  test.fixme(() => skipIfJobName(JOB_NAME_PATTERNS.OPERATOR));

  test.beforeAll(({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  let common: Common;
  let uiHelper: UIhelper;

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
    await common.loginAsKeycloakUser();
  });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/api/retry-test/**");
  });

  async function openSampleRetryTestRunForm(page: Page) {
    await uiHelper.openSidebar("Orchestrator");
    const heading = page.getByRole("heading", { name: "Workflows" });
    await expect(heading).toBeVisible({ timeout: 60000 });
    const workflowLink = page.getByRole("link", { name: /Sample Retry Test/ });
    if ((await workflowLink.count()) === 0) {
      test.skip(
        true,
        "Sample Retry Test workflow is not available in this environment",
      );
    }
    await workflowLink.click();
    await page
      .getByRole("button", { name: "Run", exact: true })
      .first()
      .click();
  }

  test("retryAllProps: 503 responses retry with delay 1500 and backoff 2 (three waits)", async ({
    page,
  }) => {
    let allPropsHits = 0;
    let firstAllPropsAt = 0;
    let lastAllPropsSuccessAt = 0;

    await page.route("**/api/retry-test/**", async (route) => {
      const url = route.request().url();
      if (url.includes("all-props")) {
        const now = Date.now();
        if (allPropsHits === 0) {
          firstAllPropsAt = now;
        }
        allPropsHits += 1;
        if (allPropsHits <= 3) {
          await route.fulfill({ status: 404, body: "unavailable" });
        } else {
          await route.fulfill({ status: 200, body: "ok" });
          lastAllPropsSuccessAt = Date.now();
        }
        return;
      }
      if (
        url.includes("status-codes-no-404") ||
        url.includes("no-retry-props")
      ) {
        await route.fulfill(jsonOk("idle"));
        return;
      }
      await route.continue();
    });

    await openSampleRetryTestRunForm(page);
    // const field = page.getByLabel(/Retry Test \(all props\)/);
    await expect(page.getByTestId("root_retryAllProps-error-text")).toBeVisible(
      { timeout: 150_000 },
    );
    // await expect(field).toHaveValue("ok", { timeout: 120_000 });

    expect(allPropsHits).toBe(4);
    // 1500*2^0 + 1500*2^1 + 1500*2^2 = 10500 ms minimum between first hit and final 200
    const span = lastAllPropsSuccessAt - firstAllPropsAt;
    expect(span).toBeGreaterThanOrEqual(9_000);
  });

  test("retryStatusCodesNoMatch: 404 is not retried when omitted from fetch:retry:statusCodes", async ({
    page,
  }) => {
    let statusEndpointHits = 0;

    await page.route("**/api/retry-test/**", async (route) => {
      const url = route.request().url();
      if (url.includes("status-codes-no-404")) {
        statusEndpointHits += 1;
        await route.fulfill({ status: 404, body: "not found" });
        return;
      }
      if (url.includes("all-props") || url.includes("no-retry-props")) {
        await route.fulfill(jsonOk("idle"));
        return;
      }
      await route.continue();
    });

    const started = Date.now();
    await openSampleRetryTestRunForm(page);
    await expect(
      //   page.getByLabel(/Retry Test \(status codes missing 404\)/),
      page.getByTestId("root_retryStatusCodesNoMatch-error-text"),
    ).toBeVisible({
      timeout: 60_000,
    });
    const elapsed = Date.now() - started;
    // maxAttempts 2 and delay 500 would add ≥500 ms backoff if a 503 were retried; 404 must not retry
    expect(statusEndpointHits).toBe(1);
    expect(elapsed).toBeLessThan(8_000);
  });

  test("retryNoProps: single fetch when fetch:retry:maxAttempts is absent", async ({
    page,
  }) => {
    let noRetryHits = 0;

    await page.route("**/api/retry-test/**", async (route) => {
      const url = route.request().url();
      if (url.includes("no-retry-props")) {
        noRetryHits += 1;
        await route.fulfill({ status: 503, body: "no retry" });
        return;
      }
      if (url.includes("all-props") || url.includes("status-codes-no-404")) {
        await route.fulfill(jsonOk("idle"));
        return;
      }
      await route.continue();
    });

    const started = Date.now();
    await openSampleRetryTestRunForm(page);
    // await expect(page.getByLabel(/Retry Test \(no retry props\)/)).toBeVisible({
    await expect(page.getByTestId("root_retryNoProps-error-text")).toBeVisible({
      timeout: 60_000,
    });
    await new Promise((r) => setTimeout(r, 2_000));
    const elapsed = Date.now() - started;
    expect(noRetryHits).toBe(1);
    expect(elapsed).toBeLessThan(15_000);
  });
});
