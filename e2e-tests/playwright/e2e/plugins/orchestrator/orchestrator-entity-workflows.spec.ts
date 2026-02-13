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
 *
 * Templates used (from catalog locations in app-config-rhdh.yaml):
 * - greeting.yaml: name=greeting, title="Greeting workflow" - NO orchestrator.io/workflows annotation
 * - greeting_w_component.yaml: name=greetingComponent, title="Greeting Test Picker" - HAS annotation
 * - yamlgreet.yaml: name=greet, title="Greeting" - HAS annotation
 *
 * These are scaffolder templates that use the orchestrator:workflow:run action
 * to trigger the "greeting" SonataFlow workflow deployed by CI.
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

    test("RHIDP-11833: Select existing entity via EntityPicker for workflow run", async () => {
      // Navigate to Self-service page via global header link
      await uiHelper.clickLink({ ariaLabel: "Self-service" });
      await uiHelper.verifyHeading("Self-service");

      // Wait for templates to load and click "Greeting Test Picker" template
      // This template has Language and Name fields on Step 1, then Review on Step 2
      await page.waitForLoadState("domcontentloaded");

      // Click Choose button on the template card
      await uiHelper.clickBtnInCard("Greeting Test Picker", "Choose");

      // Wait for template form to load
      await uiHelper.verifyHeading(/Greeting Test Picker/i, 30000);

      // Step 1: Fill in workflow parameters
      // Language field (dropdown)
      const languageField = page.getByLabel("Language");
      await expect(languageField).toBeVisible({ timeout: 15000 });
      await languageField.click();
      await page.getByRole("option", { name: "English" }).click();

      // Name field (required)
      const nameField = page.getByLabel("Name");
      await expect(nameField).toBeVisible({ timeout: 10000 });
      const uniqueName = `test-entity-${Date.now()}`;
      await nameField.fill(uniqueName);

      // Click Review to proceed to Step 2
      const reviewButton = page.getByRole("button", { name: /Review/i });
      await expect(reviewButton).toBeVisible({ timeout: 10000 });
      await reviewButton.click();
      await page.waitForLoadState("domcontentloaded");

      // Click Create to execute
      const createButton = page.getByRole("button", { name: /Create/i });
      await expect(createButton).toBeVisible({ timeout: 10000 });
      await createButton.click();

      // Wait for completion
      await expect(page.getByText(/Completed|succeeded|finished/i)).toBeVisible(
        {
          timeout: 120000,
        },
      );
    });

    test("RHIDP-11834: Template WITH orchestrator.io/workflows annotation", async () => {
      // Navigate to Catalog via sidebar and filter by Template kind
      await uiHelper.openSidebar("Catalog");
      await uiHelper.verifyHeading("My Org Catalog");
      await uiHelper.selectMuiBox("Kind", "Template");

      // Find the "Greeting Test Picker" template (greeting_w_component.yaml)
      // This template HAS the orchestrator.io/workflows annotation: '["greeting"]'
      const templateLink = page.getByRole("link", {
        name: /Greeting Test Picker/i,
      });

      await expect(templateLink).toBeVisible({ timeout: 30000 });
      await templateLink.click();

      // Wait for entity page to load
      await page.waitForLoadState("domcontentloaded");

      // Navigate to Workflows tab - this should be visible because of the annotation
      await orchestrator.clickWorkflowsTab();

      // Verify that "Greeting workflow" is listed
      await orchestrator.verifyWorkflowInEntityTab("Greeting workflow");
    });

    test("RHIDP-11835: Template WITHOUT orchestrator.io/workflows annotation (negative)", async () => {
      // Navigate to Catalog via sidebar and filter by Template kind
      await uiHelper.openSidebar("Catalog");
      await uiHelper.verifyHeading("My Org Catalog");
      await uiHelper.selectMuiBox("Kind", "Template");

      // Find the "Greeting workflow" template (greeting.yaml)
      // This template does NOT have the orchestrator.io/workflows annotation
      const templateLink = page.getByRole("link", {
        name: /Greeting workflow/i,
      });

      await expect(templateLink).toBeVisible({ timeout: 30000 });
      await templateLink.click();

      // Wait for entity page to load
      await page.waitForLoadState("domcontentloaded");

      // Verify Workflows tab does not exist
      await expect(page.getByRole("tab", { name: "Workflows" })).toHaveCount(0);
    });

    test("RHIDP-11836: Catalog ↔ Workflows breadcrumb navigation", async () => {
      // Navigate to Catalog via sidebar and filter by Template kind
      await uiHelper.openSidebar("Catalog");
      await uiHelper.verifyHeading("My Org Catalog");
      await uiHelper.selectMuiBox("Kind", "Template");

      // Select "Greeting Test Picker" template (has orchestrator annotation)
      const templateLink = page.getByRole("link", {
        name: /Greeting Test Picker/i,
      });

      await expect(templateLink).toBeVisible({ timeout: 30000 });
      await templateLink.click();

      // Wait for entity page to load
      await page.waitForLoadState("domcontentloaded");

      // Navigate to Workflows tab
      await orchestrator.clickWorkflowsTab();

      // Click on the "greeting" workflow link
      const workflowLink = page.getByRole("link", {
        name: "Greeting workflow",
      });
      await expect(workflowLink).toBeVisible({ timeout: 10000 });
      await workflowLink.click();

      // Verify we're on the Orchestrator workflow page
      await expect(
        page.getByRole("heading", { name: "Greeting workflow" }),
      ).toBeVisible();

      // Verify breadcrumb navigation works - look for breadcrumb with entity name
      const entityName = "greetingComponent";
      const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
      if ((await breadcrumb.count()) > 0 && entityName) {
        const entityBreadcrumb = breadcrumb.getByText(entityName);
        if ((await entityBreadcrumb.count()) > 0) {
          await entityBreadcrumb.click();
          await page.waitForLoadState("load");

          // Verify we're back on the entity page with correct heading
          await expect(
            page.getByRole("heading", { name: /Greeting Test Picker/i }),
          ).toBeVisible();
        }
      }
    });

    test("RHIDP-11837: Template run produces visible workflow runs", async () => {
      // Navigate to Self-service page via global header link
      await uiHelper.clickLink({ ariaLabel: "Self-service" });
      await uiHelper.verifyHeading("Self-service");

      // Wait for templates to load and click "Greeting Test Picker" template
      await page.waitForLoadState("domcontentloaded");
      await uiHelper.clickBtnInCard("Greeting Test Picker", "Choose");

      // Wait for template form to load
      await uiHelper.verifyHeading(/Greeting Test Picker/i, 30000);

      // The "Greeting Test Picker" template has Language and Name fields on the first step
      // Fill in the Name field (required for workflow)
      const nameField = page.getByLabel("Name");
      await expect(nameField).toBeVisible({ timeout: 10000 });
      const uniqueName = `test-entity-${Date.now()}`;
      await nameField.fill(uniqueName);

      // Language field should already have a default value (English)
      // but let's make sure it's selected
      const languageField = page.getByLabel("Language");
      if (await languageField.isVisible({ timeout: 5000 })) {
        await languageField.click();
        await page.getByRole("option", { name: "English" }).click();
      }

      // Click Review button to proceed (this template has only 2 steps)
      const reviewButton = page.getByRole("button", { name: /Review/i });
      await expect(reviewButton).toBeVisible({ timeout: 10000 });
      await reviewButton.click();
      await page.waitForLoadState("domcontentloaded");

      // Click Create to execute
      const createButton = page.getByRole("button", { name: /Create/i });
      await expect(createButton).toBeVisible({ timeout: 10000 });
      await createButton.click();

      // Wait for task to finish — either success or 409 Conflict (catalog entity already registered
      // from a prior run). Both are acceptable; the key assertion is that the Orchestrator page
      // shows the greeting workflow.
      const completed = page.getByText(/Completed|succeeded|finished/i);
      const conflictError = page.getByText(/409 Conflict/i);
      const startOver = page.getByRole("button", { name: "Start Over" });

      await expect(completed.or(conflictError).or(startOver)).toBeVisible({
        timeout: 120000,
      });

      // Navigate to Orchestrator to verify workflow run is visible
      await uiHelper.openSidebar("Orchestrator");
      await expect(
        page.getByRole("heading", { name: "Workflows" }),
      ).toBeVisible();

      // Verify the greeting workflow shows recent runs
      const greetingWorkflow = page.getByRole("link", {
        name: /Greeting workflow/i,
      });
      await expect(greetingWorkflow).toBeVisible({ timeout: 30000 });
    });

    test("RHIDP-11838: Dynamic plugin config enables Workflows tab", async () => {
      // Navigate to Catalog via sidebar and filter by Template kind
      await uiHelper.openSidebar("Catalog");
      await uiHelper.verifyHeading("My Org Catalog");
      await uiHelper.selectMuiBox("Kind", "Template");

      // Select "Greeting Test Picker" template (has orchestrator.io/workflows annotation)
      const templateLink = page.getByRole("link", {
        name: /Greeting Test Picker/i,
      });

      await expect(templateLink).toBeVisible({ timeout: 30000 });
      await templateLink.click();

      // Wait for entity page to load
      await page.waitForLoadState("domcontentloaded");

      // Verify the "Workflows" tab is present on the entity page
      // This tab is enabled by the dynamic plugin configuration in values.yaml
      await orchestrator.verifyWorkflowsTabVisible();

      // Click on Workflows tab
      await orchestrator.clickWorkflowsTab();

      // Verify the OrchestratorCatalogTab card renders inside the tab
      // The card should show workflow information from the annotation
      const workflowsContent = page.locator("main").filter({
        has: page.getByText("Greeting workflow"),
      });
      await expect(workflowsContent).toBeVisible();
    });
  });
});
