import { test, expect } from "@playwright/test";

import { Common } from "../../utils/common";

test("tmp: settings general renders InfoCard", { tag: "@cluster-free" }, async ({ page }) => {
  const common = new Common(page);
  await common.loginAsGuest();

  await page.goto("/settings/general");
  await expect(page.getByText("RHDH Build info")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("TechDocs builder: local")).toBeVisible();
  await expect(page.getByText("Authentication provider: Github")).toBeVisible();

  await page.getByTitle("Show more").click();
  await expect(page.getByText("RBAC: disabled")).toBeVisible();
});
