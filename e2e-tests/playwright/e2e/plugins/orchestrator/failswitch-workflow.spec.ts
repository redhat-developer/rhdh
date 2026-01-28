import { test, expect } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";
import { execSync } from "child_process";

test.describe("Orchestrator failswitch workflow tests", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled to save disk space

  let uiHelper: UIhelper;
  let common: Common;
  let orchestrator: Orchestrator;

  test.beforeEach(async ({ page }) => {
    uiHelper = new UIhelper(page);
    common = new Common(page);
    orchestrator = new Orchestrator(page);
    await common.loginAsKeycloakUser();
  });

  test("Failswitch workflow execution and workflow tab validation", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("OK");
    await orchestrator.reRunFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
    await orchestrator.reRunFailSwitchWorkflow("KO");
    await orchestrator.validateWorkflowStatus("Failed");
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.validateWorkflowAllRuns();
  });

  test("Failswitch workflow execution and test abort workflow", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
  });

  test("Test Running button is enabled when workflow is running", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.waitForWorkflowStatus("Running");
  });

  test("Test status icons are visible in all runs tab", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("OK");
    await orchestrator.waitForWorkflowStatus("Completed");
    await orchestrator.reRunFailSwitchWorkflow("KO");
    await orchestrator.waitForWorkflowStatus("Failed");
    await orchestrator.reRunFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
    await orchestrator.waitForWorkflowStatus("Aborted");
    await orchestrator.reRunFailSwitchWorkflow("Wait");
    await orchestrator.waitForWorkflowStatus("Running");
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.validateWorkflowAllRunsStatusIcons();
  });

  test("Test rerunning from failure point using failswitch workflow", async () => {
    const patchIncorrectValue = execSync(`oc -n ${process.env.RHDH_NAMESPACE} patch sonataflow failswitch --type merge -p '{"spec": { "podTemplate": { "container": { "env": [{"name": "HTTPBIN",  "value": "https://foobar.org/"}]}}}}'`).toString().trim();
    console.log(patchIncorrectValue);

    const reloadPod = execSync(`oc rollout restart deployment failswitch -n ${process.env.RHDH_NAMESPACE}`).toString().trim();
    console.log(reloadPod);

    const waitPodRunningResult = execSync(`oc wait --for=condition=ready pod -l app.kubernetes.io/name=failswitch -n ${process.env.RHDH_NAMESPACE} --timeout=120s`).toString().trim();
    console.log(waitPodRunningResult);

    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.validateWorkflowStatus("Failed");

    const patchCorrectValue = execSync(`oc -n ${process.env.RHDH_NAMESPACE} patch sonataflow failswitch --type merge -p '{"spec": { "podTemplate": { "container": { "env": [{"name": "HTTPBIN",  "value": "https://httpbin.org/"}]}}}}'`).toString().trim();
    console.log(patchCorrectValue);

    const reloadPodsResult = execSync(`oc rollout restart deployment failswitch -n ${process.env.RHDH_NAMESPACE}`).toString().trim();
    console.log(reloadPodsResult);

    const waitPodsRunningResultAgain = execSync(`oc wait --for=condition=ready pod -l app.kubernetes.io/name=failswitch -n ${process.env.RHDH_NAMESPACE} --timeout=120s`).toString().trim();
    console.log(waitPodsRunningResultAgain);

    await orchestrator.reRunOnFailure("From failure point");
    await orchestrator.validateWorkflowStatus("Completed");
  });

  test("Failswitch links to another workflow and link works", async ({ page }) => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("OK");

    // Verify suggested next workflow section and navigate via the greeting link
    await expect(page.getByRole("heading", { name: /suggested next workflow/i })).toBeVisible();
    const greetingLink = page.getByRole("link", { name: /greeting/i });
    await expect(greetingLink).toBeVisible();
    await greetingLink.click();

    // Popup should appear for Greeting workflow
    await expect(page.getByRole("dialog", { name: /greeting workflow/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /run workflow/i })).toBeVisible();
    await page.getByRole("button", { name: /run workflow/i }).click();

    // Verify Greeting workflow execute view shows correct header and "Next" button
    await expect(page.getByText("Greeting workflow")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });
});
