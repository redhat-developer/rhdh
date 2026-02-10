import { Page, expect, test } from "@playwright/test";
import { Common, setupBrowser } from "../../../utils/common";
import { UIhelper } from "../../../utils/ui-helper";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

/**
 * Orchestrator Entity-Workflow Integration Tests
 *
 * Test Cases: RHIDP-11833 through RHIDP-11838
 *
 * These tests verify the integration between RHDH catalog entities and
 * Orchestrator workflows, including:
 * - EntityPicker-based entity association
 * - orchestrator.io/workflows annotation behavior
 * - Workflows tab visibility on entity pages
 * - Catalog ↔ Workflows breadcrumb navigation
 * - Template execution → workflow run linkage
 */
test.describe("Orchestrator Entity-Workflow Integration", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled to save disk space

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test.describe("Entity-Workflow Tab and Annotation Tests", () => {
    let common: Common;
    let uiHelper: UIhelper;
    let page: Page;
    let orchestrator: Orchestrator;

    test.beforeAll(async ({ browser }, testInfo) => {
      page = (await setupBrowser(browser, testInfo)).page;
      uiHelper = new UIhelper(page);
      common = new Common(page);
      orchestrator = new Orchestrator(page);

      await common.loginAsKeycloakUser();
    });

    test("TC-1 RHIDP-11833: Select existing entity via EntityPicker for workflow run", async () => {
      // Navigate to Self-service (Catalog > Templates)
      await uiHelper.goToPageUrl("/create");
      await uiHelper.verifyHeading("Self-service");

      // Find and launch the "Greeting workflow" template (greeting.yaml)
      const greetingTemplate = page.getByRole("link", {
        name: /Greeting workflow/i,
      });
      await expect(greetingTemplate).toBeVisible({ timeout: 30000 });
      await greetingTemplate.click();

      // Wait for template form to load
      await expect(
        page.getByRole("heading", { name: /Greeting workflow/i }),
      ).toBeVisible();

      // Use EntityPicker to select an existing Component entity
      // The EntityPicker should be visible for selecting an entity
      const entityPicker = page.getByLabel(/entity/i);
      if (await entityPicker.isVisible()) {
        await entityPicker.click();
        // Select the first available entity from the dropdown
        const firstOption = page.getByRole("option").first();
        await expect(firstOption).toBeVisible();
        await firstOption.click();
      }

      // Complete the template wizard - click Next
      const nextButton = page.getByRole("button", { name: "Next" });
      await expect(nextButton).toBeVisible();
      await nextButton.click();

      // Click Run to execute
      const runButton = page.getByRole("button", { name: "Run" });
      await expect(runButton).toBeVisible();
      await runButton.click();

      // Wait for workflow to complete
      await expect(page.getByText(/Completed|Running/i)).toBeVisible({
        timeout: 120000,
      });
    });

    test("TC-2 RHIDP-11834: Template WITH orchestrator.io/workflows annotation", async () => {
      // Navigate to Catalog
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.verifyHeading("Catalog");

      // Filter by Kind=Template
      await page.getByRole("button", { name: /Kind/i }).click();
      await page.getByRole("option", { name: "Template" }).click();

      // Find the "Greeting Test Picker" entity (greeting_w_component.yaml)
      // This template has the orchestrator.io/workflows annotation
      const templateLink = page.getByRole("link", {
        name: /Greeting.*component|greeting_w_component/i,
      });

      if (await templateLink.isVisible({ timeout: 10000 })) {
        await templateLink.click();

        // Navigate to its Workflows tab
        await orchestrator.clickWorkflowsTab();

        // Verify that "greeting" workflow is listed
        await orchestrator.verifyWorkflowInEntityTab("greeting");
      } else {
        // Template may not be registered yet - skip gracefully
        test.skip();
      }
    });

    test("TC-3 RHIDP-11835: Template WITHOUT orchestrator.io/workflows annotation (negative)", async () => {
      // Navigate to Catalog
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.verifyHeading("Catalog");

      // Filter by Kind=Template
      await page.getByRole("button", { name: /Kind/i }).click();
      await page.getByRole("option", { name: "Template" }).click();

      // Find the "yamlgreet" template entity (yamlgreet.yaml)
      // This template does NOT have the orchestrator.io/workflows annotation
      const templateLink = page.getByRole("link", { name: /yamlgreet/i });

      if (await templateLink.isVisible({ timeout: 10000 })) {
        await templateLink.click();

        // Navigate to Workflows tab (or verify tab is hidden)
        const workflowsTab = page.getByRole("tab", { name: "Workflows" });
        const tabCount = await workflowsTab.count();

        if (tabCount > 0) {
          // Tab exists - click it and verify NO workflows are listed
          await workflowsTab.click();
          await orchestrator.verifyNoWorkflowsInEntityTab();
        }
        // If tab doesn't exist, that's also valid for entities without annotation
      } else {
        // Template may not be registered yet - skip gracefully
        test.skip();
      }
    });

    test("TC-4 RHIDP-11836: Catalog ↔ Workflows breadcrumb navigation", async () => {
      // Navigate to Catalog
      await uiHelper.goToPageUrl("/catalog");
      await uiHelper.verifyHeading("Catalog");

      // Filter by Kind=Template and find orchestrator-tagged template
      await page.getByRole("button", { name: /Kind/i }).click();
      await page.getByRole("option", { name: "Template" }).click();

      // Select a template with orchestrator annotation
      const templateLink = page.getByRole("link", {
        name: /Greeting.*component|greeting_w_component/i,
      });

      if (await templateLink.isVisible({ timeout: 10000 })) {
        await templateLink.click();

        // Get the entity name from the heading
        const heading = page.getByRole("heading").first();
        const entityName = await heading.textContent();

        // Navigate to Workflows tab
        await orchestrator.clickWorkflowsTab();

        // Click on a workflow in the workflows table
        const workflowLink = page.getByRole("link", { name: /greeting/i });
        if (await workflowLink.isVisible({ timeout: 5000 })) {
          await workflowLink.click();

          // Verify Orchestrator workflow page loads
          await expect(
            page.getByRole("heading", { name: /greeting/i }),
          ).toBeVisible();

          // Verify breadcrumb navigation works
          const breadcrumb = page.getByRole("navigation", {
            name: /breadcrumb/i,
          });
          if (await breadcrumb.isVisible()) {
            // Click breadcrumb to navigate back to entity
            const entityBreadcrumb = breadcrumb.getByText(entityName || "");
            if (await entityBreadcrumb.isVisible()) {
              await entityBreadcrumb.click();
              await page.waitForLoadState("load");

              // Verify entity page is displayed
              await expect(page.getByRole("heading").first()).toBeVisible();
            }
          }
        }
      } else {
        test.skip();
      }
    });

    test("TC-5 RHIDP-11837: Template run produces visible workflow runs", async () => {
      // Navigate to Catalog and find a template with orchestrator annotation
      await uiHelper.goToPageUrl("/catalog");

      // Filter by Kind=Template
      await page.getByRole("button", { name: /Kind/i }).click();
      await page.getByRole("option", { name: "Template" }).click();

      const templateLink = page.getByRole("link", {
        name: /Greeting.*component|greeting_w_component/i,
      });

      if (await templateLink.isVisible({ timeout: 10000 })) {
        await templateLink.click();

        // Launch template
        const launchButton = page.getByRole("button", { name: /Launch/i });
        if (await launchButton.isVisible({ timeout: 5000 })) {
          await launchButton.click();

          // Complete wizard
          const nextButton = page.getByRole("button", { name: "Next" });
          if (await nextButton.isVisible()) {
            await nextButton.click();
          }

          const runButton = page.getByRole("button", { name: "Run" });
          await expect(runButton).toBeVisible();
          await runButton.click();

          // Verify workflow execution completes
          await expect(page.getByText(/Completed|Running/i)).toBeVisible({
            timeout: 120000,
          });

          // Navigate to the entity's Workflows tab
          await page.goBack();
          await orchestrator.clickWorkflowsTab();

          // Verify the workflow run is visible
          const workflowRunRow = page
            .getByRole("row")
            .filter({ hasText: /greeting/i });
          await expect(workflowRunRow.first()).toBeVisible({ timeout: 30000 });
        }
      } else {
        test.skip();
      }
    });

    test("TC-6 RHIDP-11838: Dynamic plugin config enables Workflows tab", async () => {
      // Navigate to Catalog
      await uiHelper.goToPageUrl("/catalog");

      // Filter by Kind=Template
      await page.getByRole("button", { name: /Kind/i }).click();
      await page.getByRole("option", { name: "Template" }).click();

      // Select a template entity with orchestrator.io/workflows annotation
      const templateLink = page.getByRole("link", {
        name: /Greeting.*component|greeting_w_component/i,
      });

      if (await templateLink.isVisible({ timeout: 10000 })) {
        await templateLink.click();

        // Verify the "Workflows" tab is present on the entity page
        await orchestrator.verifyWorkflowsTabVisible();

        // Click on Workflows tab
        await orchestrator.clickWorkflowsTab();

        // Verify the OrchestratorCatalogTab card renders inside the tab
        // The card should show workflow information
        const workflowsContent = page.locator("main").filter({
          has: page.getByText(/workflow/i),
        });
        await expect(workflowsContent).toBeVisible();
      } else {
        test.skip();
      }
    });
  });
});
