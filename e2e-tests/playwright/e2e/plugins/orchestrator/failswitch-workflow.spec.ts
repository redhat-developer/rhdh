import { test, expect } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";
import { LogUtils } from "../../audit-log/log-utils";

test.describe("Orchestrator failswitch workflow tests", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.AKS)); // skipping orchestrator tests on AKS - plugins disabled
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.EKS)); // skipping orchestrator tests on EKS - plugins disabled
  // TODO: https://issues.redhat.com/browse/RHDHBUGS-2184 fix orchestrator tests on Operator deployment
  test.fixme(() => skipIfJobName(JOB_NAME_PATTERNS.OPERATOR));

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
    await orchestrator.validateCurrentWorkflowStatus("Completed");
    await orchestrator.reRunFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
    await orchestrator.reRunFailSwitchWorkflow("KO");
    await orchestrator.validateCurrentWorkflowStatus("Failed");
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.validateCurrentWorkflowStatus("Running");
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.validateWorkflowAllRuns();
    await orchestrator.validateWorkflowAllRunsStatusIcons();
  });

  test("Test abort workflow", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
  });

  test("Test Running status validations", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.validateWorkflowStatusDetails("Running");
  });

  test("Test Failed status validations", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("KO");
    await orchestrator.validateWorkflowStatusDetails("Failed");
  });

  test("Test Completed status validations", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("OK");
    await orchestrator.validateWorkflowStatusDetails("Completed");
  });

  test("Test rerunning from failure point using failswitch workflow", async ({}, testInfo) => {
    test.setTimeout(240000); // 4 minutes: pod restarts + 60s sleep + failure/recovery time
    const ns = testInfo.project.name;

    test.skip(!ns, "NAME_SPACE not set");

    const originalHttpbin = "https://httpbin.org/";
    try {
      await patchHttpbin(ns!, "https://foobar.org/");
      await restartAndWait(ns!);

      await uiHelper.openSidebar("Orchestrator");
      await orchestrator.selectFailSwitchWorkflowItem();
      await orchestrator.runFailSwitchWorkflow("Wait");
      await orchestrator.validateCurrentWorkflowStatus("Failed"); // 2 minutes: 60s sleep + time to fail

      await patchHttpbin(ns!, originalHttpbin);
      await restartAndWait(ns!);

      await orchestrator.reRunOnFailure("From failure point");
      await orchestrator.validateCurrentWorkflowStatus("Completed");
    } catch (e) {
      test.info().annotations.push({
        type: "test-error",
        description: String(e),
      });
      throw e;
    } finally {
      try {
        await cleanupAfterTest(ns!, originalHttpbin);
      } catch (cleanupErr) {
        test.info().annotations.push({
          type: "cleanup-error",
          description: String(cleanupErr),
        });
      }
    }
  });

  test("Failswitch links to another workflow and link works", async ({
    page,
  }) => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("OK");

    // Verify suggested next workflow section and navigate via the greeting link
    await expect(
      page.getByRole("heading", { name: /suggested next workflow/i }),
    ).toBeVisible();
    const greetingLink = page.getByRole("link", { name: /greeting/i });
    await expect(greetingLink).toBeVisible();
    await greetingLink.click();

    // Popup should appear for Greeting workflow
    await expect(
      page.getByRole("dialog", { name: /greeting workflow/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /run workflow/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /run workflow/i }).click();

    // Verify Greeting workflow execute view shows correct header and "Next" button
    await expect(
      page.getByRole("heading", { name: "Greeting workflow" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });
});

async function getHttpbinValue(ns: string): Promise<string | undefined> {
  const args = [
    "-n",
    ns,
    "get",
    "sonataflow",
    "failswitch",
    "-o",
    `jsonpath={.spec.podTemplate.container.env[?(@.name=='HTTPBIN')].value}`,
  ];
  const out = await LogUtils.executeCommand("oc", args);
  return out || undefined;
}

async function patchHttpbin(ns: string, value: string): Promise<void> {
  const patch = `{"spec":{"podTemplate":{"container":{"env":[{"name":"HTTPBIN","value":"${value}"}]}}}}`;
  console.log("patching HTTPBIN in sontaflow resource to ", value);
  const args = [
    "-n",
    ns,
    "patch",
    "sonataflow",
    "failswitch",
    "--type",
    "merge",
    "-p",
    patch,
  ];
  await LogUtils.executeCommand("oc", args);
}

async function restartAndWait(ns: string): Promise<void> {
  console.log("restarting deployment failswitch");
  const restartArgs = [
    "-n",
    ns,
    "rollout",
    "restart",
    "deployment",
    "failswitch",
  ];
  await LogUtils.executeCommand("oc", restartArgs);

  console.log("waiting for pods to be ready");
  const waitArgs = [
    "-n",
    ns,
    "wait",
    "--for=condition=ready",
    "pod",
    "-l",
    "app.kubernetes.io/name=failswitch",
    "--timeout=5s",
  ];
  await LogUtils.executeCommandWithRetries("oc", waitArgs, 5);
}

async function cleanupAfterTest(
  ns: string,
  originalHttpbin: string,
): Promise<void> {
  const currentHttpbin = await getHttpbinValue(ns!);
  if (currentHttpbin !== originalHttpbin) {
    await patchHttpbin(ns!, originalHttpbin);
    await restartAndWait(ns!);
  }
}
