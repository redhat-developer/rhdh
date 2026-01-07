import AxeBuilder from "@axe-core/playwright";
import { Page, TestInfo } from "@playwright/test";

export async function runAccessibilityTests(
  page: Page,
  testInfo: TestInfo,
  attachName = "accessibility-scan-results.violations.json",
) {
  // Type mismatch between Playwright's Page and AxeBuilder's expected type
  const accessibilityScanResults = await new AxeBuilder({ page } as unknown as {
    page: typeof page;
  })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  await testInfo.attach(attachName, {
    body: JSON.stringify(accessibilityScanResults.violations, null, 2),
    contentType: "application/json",
  });
}
