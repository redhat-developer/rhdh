import { test, expect } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";
import { LogUtils } from "../../audit-log/log-utils";

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
      await orchestrator.validateCurrentWorkflowStatus("Failed", 120000); // 2 minutes: 60s sleep + time to fail

      await patchHttpbin(ns!, originalHttpbin);
      await restartAndWait(ns!);

      await orchestrator.reRunOnFailure("From failure point");
      await orchestrator.validateCurrentWorkflowStatus("Completed");
    } catch (e) {
      test
        .info()
        .annotations.push({ type: "oc-error", description: String(e) });
      throw e;
    } finally {
      try {
        const currentHttpbin = await getHttpbinValue(ns!);
        if (currentHttpbin !== originalHttpbin) {
          await patchHttpbin(ns!, originalHttpbin ?? "https://httpbin.org/");
          await restartAndWait(ns!);
        }
      } catch (rollbackErr) {
        test.info().annotations.push({
          type: "rollback-error",
          description: String(rollbackErr),
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

async function runOc(
  cmd: string,
  { retries = 2 }: { retries?: number } = {},
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const output = await LogUtils.executeShellCommand(cmd);
      return output.trim();
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

async function getHttpbinValue(ns: string): Promise<string | undefined> {
  const cmd =
    `oc -n ${ns} get sonataflow failswitch ` +
    `-o jsonpath="{.spec.podTemplate.container.env[?(@.name=='HTTPBIN')].value}"`;
  const out = await runOc(cmd, { retries: 1 });
  return out || undefined;
}

async function patchHttpbin(ns: string, value: string): Promise<void> {
  const patch = `'{"spec":{"podTemplate":{"container":{"env":[{"name":"HTTPBIN","value":"${value}"}]}}}}'`;
  console.log("patching HTTPBIN in sontaflow resource to ", value);
  await runOc(
    `oc -n ${ns} patch sonataflow failswitch --type merge -p ${patch}`,
    { retries: 2 },
  );
}

async function restartAndWait(ns: string): Promise<void> {
  console.log("restarting deployment failswitch");
  await runOc(`oc -n ${ns} rollout restart deployment failswitch`, {
    retries: 1,
  });
  console.log("waiting for pods to be ready");
  await runOc(
    `oc -n ${ns} wait --for=condition=ready pod -l app.kubernetes.io/name=failswitch --timeout=120s`,
    { retries: 3 },
  );
}
