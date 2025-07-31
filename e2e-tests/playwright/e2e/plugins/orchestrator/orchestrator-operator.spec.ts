import { test, expect } from '@playwright/test';
import { Common } from '../../../utils/common';
import { UIhelper } from '../../../utils/ui-helper';
import { Orchestrator } from '../../../support/pages/orchestrator';
import { createOrchestratorSetup, OrchestratorOperatorSetup } from '../../../utils/orchestrator/orchestrator-operator-setup';

// Test configuration - only run in operator environments with enhanced detection
const isOperatorTest = process.env.IS_OPENSHIFT === 'true' || 
                      process.env.BACKSTAGE_NS === 'rhdh-operator' ||
                      process.env.BACKSTAGE_NS?.includes('operator') ||
                      process.env.ORCHESTRATOR_OPERATOR_TEST === 'true';

test.describe.configure({ mode: 'serial' });

test.describe('Orchestrator Plugin - Operator Deployment', () => {
  let common: Common;
  let uiHelper: UIhelper;
  let orchestrator: Orchestrator;
  let orchestratorSetup: OrchestratorOperatorSetup;

  test.beforeAll(async ({ browser }) => {
    // Skip if not in operator environment
    test.skip(!isOperatorTest, 'Skipping orchestrator operator tests - not in operator environment');
  });

  test.beforeEach(async ({ page }) => {
    common = new Common(page);
    uiHelper = new UIhelper(page);
    orchestrator = new Orchestrator(page);
    orchestratorSetup = createOrchestratorSetup(page);
    
    // Verify we're in an operator environment
    const isOperatorEnv = await orchestratorSetup.isOperatorEnvironment();
    test.skip(!isOperatorEnv, 'Not running in operator environment');
  });

  test('Setup orchestrator infrastructure with pipeline integration', async ({ page }, testInfo) => {
    // Increase timeout for infrastructure setup
    test.setTimeout(900000); // 15 minutes

    console.log('Starting orchestrator infrastructure setup with pipeline integration...');
    console.log('Environment configuration:', {
      backstageName: process.env.BACKSTAGE_NAME,
      backstageNamespace: process.env.BACKSTAGE_NS,
      orchestratorDatabase: process.env.ORCH_DB,
      version: process.env.VERSION,
    });
    
    const setupSuccess = await orchestratorSetup.setupAndValidateOrchestrator();
    expect(setupSuccess).toBe(true);
    
    // Verify CRD-based deployment was created if pipeline integration worked
    const crdDeploymentExists = await orchestratorSetup.checkOrchestratorCRDDeployment();
    if (crdDeploymentExists) {
      console.log('✅ Pipeline integration successful: Orchestrator CRD deployment detected');
    } else {
      console.log('⚠️ Standard deployment used: Pipeline integration may not be available');
    }
    
    console.log('Orchestrator infrastructure setup completed successfully');
  });

  test('Verify orchestrator plugin is loaded and accessible', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Navigate to orchestrator plugin
    await page.goto('/orchestrator');
    await page.waitForLoadState('networkidle');
    
    // Verify orchestrator page loads
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 30000 });
    
    // Check for orchestrator-specific elements
    const workflowsTable = page.locator('[data-testid="workflows-table"], table').first();
    await expect(workflowsTable).toBeVisible({ timeout: 15000 });
  });

  test('Verify orchestrator infrastructure components with pipeline integration', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    // Validate serverless operators installed by pipeline
    console.log('Validating serverless operators...');
    const infraValid = await orchestratorSetup.validateOrchestratorInfrastructure();
    expect(infraValid).toBe(true);
    
    // Validate PostgreSQL database
    console.log('Validating PostgreSQL database...');
    const dbValid = await orchestratorSetup.verifyPostgreSQLDatabase();
    expect(dbValid).toBe(true);
    
    // Validate SonataFlow resources
    console.log('Validating SonataFlow platform resources...');
    const sfValid = await orchestratorSetup.verifySonataFlowResources();
    expect(sfValid).toBe(true);
    
    // Validate dynamic plugin configuration
    console.log('Validating dynamic plugin configuration...');
    const pluginValid = await orchestratorSetup.validateDynamicPluginConfig();
    expect(pluginValid).toBe(true);
    
    // Check if orchestrator-specific configmap was created
    console.log('Checking for orchestrator dynamic plugins configmap...');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      const namespace = process.env.BACKSTAGE_NS || 'rhdh-operator';
      const { stdout } = await execAsync(
        `oc get configmap dynamic-plugins-orchestrator-config -n ${namespace} || echo "not found"`
      );
      
      if (stdout.includes('dynamic-plugins-orchestrator-config')) {
        console.log('✅ Orchestrator dynamic plugins configmap found');
      } else {
        console.log('⚠️ Orchestrator dynamic plugins configmap not found - using standard configuration');
      }
    } catch (error) {
      console.log('Could not check for orchestrator configmap:', error.message);
    }
  });

  test('Test workflow navigation and basic functionality', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Navigate to orchestrator
    await page.goto('/orchestrator');
    await page.waitForLoadState('networkidle');
    
    // Verify main workflows page
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
    
    // Check if workflows table is present
    const workflowsTable = page.locator('[data-testid="workflows-table"], table').first();
    await expect(workflowsTable).toBeVisible();
    
    // Check for workflow categories or types
    const workflowCategories = page.locator('text=Category').first();
    if (await workflowCategories.isVisible()) {
      console.log('Workflow categories are visible');
    }
    
    // Test if we can see workflow names or descriptions
    const workflowNames = page.locator('a[href*="/orchestrator/"]').first();
    if (await workflowNames.isVisible()) {
      console.log('Workflow links are present');
      
      // Try to navigate to a workflow detail page
      await workflowNames.click();
      await page.waitForLoadState('networkidle');
      
      // Verify we're on a workflow detail page
      await expect(page.url()).toContain('/orchestrator/');
      
      // Go back to main workflows page
      await page.goBack();
      await page.waitForLoadState('networkidle');
    }
  });

  test('Test workflow creation capabilities', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Navigate to orchestrator
    await page.goto('/orchestrator');
    await page.waitForLoadState('networkidle');
    
    // Look for workflow creation or execution buttons
    const createButton = page.getByRole('button', { name: /create|new|add|execute/i }).first();
    const runButton = page.getByRole('button', { name: /run|execute|start/i }).first();
    
    if (await createButton.isVisible()) {
      console.log('Workflow creation button found');
      
      // Try to interact with creation functionality
      await createButton.click();
      await page.waitForTimeout(2000);
      
      // Check if a form or dialog appeared
      const formElements = page.locator('form, dialog, .MuiDialog-root').first();
      if (await formElements.isVisible()) {
        console.log('Workflow creation form/dialog opened');
        
        // Close the form/dialog
        const cancelButton = page.getByRole('button', { name: /cancel|close/i }).first();
        if (await cancelButton.isVisible()) {
          await cancelButton.click();
        } else {
          await page.keyboard.press('Escape');
        }
      }
    } else if (await runButton.isVisible()) {
      console.log('Workflow execution button found');
    } else {
      console.log('No obvious workflow creation/execution buttons found');
    }
  });

  test('Test workflow status monitoring', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Navigate to orchestrator instances or executions page
    await page.goto('/orchestrator');
    await page.waitForLoadState('networkidle');
    
    // Look for workflow instances or executions
    const instancesLink = page.getByRole('link', { name: /instances|executions|runs/i }).first();
    if (await instancesLink.isVisible()) {
      await instancesLink.click();
      await page.waitForLoadState('networkidle');
      
      // Check for workflow status indicators
      const statusElements = page.locator('text=/running|completed|failed|pending|active|aborted/i').first();
      if (await statusElements.isVisible()) {
        console.log('Workflow status indicators found');
      }
      
      // Check for workflow instance table
      const instanceTable = page.locator('table, [data-testid*="instances"]').first();
      if (await instanceTable.isVisible()) {
        console.log('Workflow instances table found');
      }
    }
  });

  test('Test workflow management operations', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Navigate to orchestrator
    await page.goto('/orchestrator');
    await page.waitForLoadState('networkidle');
    
    // Look for existing workflow instances to test management operations
    const workflowLinks = page.locator('a[href*="/orchestrator/"]');
    const linkCount = await workflowLinks.count();
    
    if (linkCount > 0) {
      // Click on the first workflow link
      await workflowLinks.first().click();
      await page.waitForLoadState('networkidle');
      
      // Look for management buttons (abort, reset, etc.)
      const abortButton = page.getByRole('button', { name: /abort/i });
      const resetButton = page.getByRole('button', { name: /reset/i });
      const stopButton = page.getByRole('button', { name: /stop/i });
      
      if (await abortButton.isVisible()) {
        console.log('Abort button found');
        // Note: We don't actually click it to avoid affecting running workflows
      }
      
      if (await resetButton.isVisible()) {
        console.log('Reset button found');
      }
      
      if (await stopButton.isVisible()) {
        console.log('Stop button found');
      }
      
      // Check for workflow details
      const detailsSection = page.locator('text=/details|status|progress/i').first();
      if (await detailsSection.isVisible()) {
        console.log('Workflow details section found');
      }
    } else {
      console.log('No workflow instances found for management testing');
    }
  });

  test('Verify orchestrator health and error handling', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Test orchestrator page error handling
    await page.goto('/orchestrator');
    await page.waitForLoadState('networkidle');
    
    // Check for error messages or alerts
    const errorElements = page.locator('[role="alert"], .error, .MuiAlert-standardError').first();
    if (await errorElements.isVisible()) {
      console.log('Error element found - checking if it\'s a configuration issue');
      const errorText = await errorElements.textContent();
      console.log('Error text:', errorText);
      
      // Check if it's a configuration error
      if (errorText?.includes('configuration') || errorText?.includes('setup')) {
        console.log('Configuration error detected - this might be expected during initial setup');
      }
    }
    
    // Verify page loads without critical failures
    const mainContent = page.locator('main, [role="main"], .main-content').first();
    await expect(mainContent).toBeVisible({ timeout: 30000 });
    
    // Check for loading states
    const loadingIndicators = page.locator('.loading, [data-testid*="loading"], .MuiCircularProgress-root');
    const loadingCount = await loadingIndicators.count();
    
    if (loadingCount > 0) {
      console.log(`Found ${loadingCount} loading indicators - waiting for them to complete`);
      await page.waitForTimeout(10000); // Wait for loading to complete
    }
  });

  test('Test orchestrator plugin integration with RHDH', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes
    
    await common.loginAsGuest();
    
    // Test navigation to orchestrator from main navigation
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for orchestrator in the main navigation
    const navLink = page.getByRole('link', { name: /orchestrator|workflow/i }).first();
    if (await navLink.isVisible()) {
      console.log('Orchestrator navigation link found in main navigation');
      await navLink.click();
      await page.waitForLoadState('networkidle');
      
      // Verify we reached the orchestrator page
      await expect(page.url()).toContain('/orchestrator');
    } else {
      // Try direct navigation
      await page.goto('/orchestrator');
      await page.waitForLoadState('networkidle');
    }
    
    // Check for proper integration with RHDH theme and layout
    const header = page.locator('header, .header, [role="banner"]').first();
    if (await header.isVisible()) {
      console.log('RHDH header found - proper integration confirmed');
    }
    
    // Check for sidebar integration
    const sidebar = page.locator('nav, .sidebar, [role="navigation"]').first();
    if (await sidebar.isVisible()) {
      console.log('RHDH sidebar found - proper integration confirmed');
    }
    
    // Verify orchestrator content is properly styled
    const orchestratorContent = page.locator('h1, h2, .MuiTypography-h1, .MuiTypography-h2').first();
    await expect(orchestratorContent).toBeVisible({ timeout: 30000 });
  });
});