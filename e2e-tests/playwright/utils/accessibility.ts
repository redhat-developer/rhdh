import AxeBuilder from "@axe-core/playwright";
import { Page, TestInfo } from "@playwright/test";

export async function runAccessibilityTests(
  page: Page,
  testInfo: TestInfo,
  attachName = "accessibility-scan-results.violations.json",
) {
  // Let Backstage loading indicators finish before scanning the page shell.
  await page
    .locator('[role="progressbar"]')
    .first()
    .waitFor({ state: "hidden", timeout: 60_000 })
    .catch(() => {});

  // Type mismatch between Playwright's Page and AxeBuilder's expected type
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @axe-core/playwright Page type differs from @playwright/test
  const accessibilityScanResults = await new AxeBuilder({ page } as unknown as {
    page: typeof page;
  })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules([
      "color-contrast",
      // Known global shell violations tracked under RHDHPLAN-954.
      "aria-progressbar-name",
      "list",
      "nested-interactive",
    ])
    .analyze();
  await testInfo.attach(attachName, {
    body: JSON.stringify(accessibilityScanResults.violations, null, 2),
    contentType: "application/json",
  });

  const criticalViolations = accessibilityScanResults.violations.filter(
    (violation) => violation.impact === "critical",
  );

  if (criticalViolations.length > 0) {
    const summary = criticalViolations
      .map((violation) => `${violation.id} (${violation.impact})`)
      .join(", ");
    throw new Error(
      `Accessibility scan found ${criticalViolations.length} critical violation(s): ${summary}`,
    );
  }
}
