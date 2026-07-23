import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { LogUtils } from "../../audit-log/log-utils";

type EnvEntry = { name: string; value: string };

test.describe("Orchestrator failswitch workflow tests", () => {
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

    // Avoid flaky public httpbin.org (503s during retrigger). Use in-cluster mock + local fail URL.
    const originalHttpbin = `http://e2e-httpbin.${ns}.svc.cluster.local/`;
    try {
      await ensureE2eHttpbin(ns!);
      await patchHttpbin(ns!, "http://127.0.0.1:1/");
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

/** Minimal in-cluster /get mock so recovery does not depend on public httpbin.org. */
async function ensureE2eHttpbin(ns: string): Promise<void> {
  const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: e2e-httpbin
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: e2e-httpbin
  template:
    metadata:
      labels:
        app: e2e-httpbin
    spec:
      containers:
        - name: httpbin
          image: registry.access.redhat.com/ubi9/python-311@sha256:a0bdb55576fc5b8d6704279307817828ef027e1065533ceba133fe9516003a6c
          command:
            - python3
            - -c
            - |
              from http.server import HTTPServer, BaseHTTPRequestHandler
              class H(BaseHTTPRequestHandler):
                def do_GET(self):
                  b=b'{"args":{},"headers":{},"origin":"e2e","url":"http://e2e-httpbin/get"}'
                  self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
                def log_message(self,*_): pass
              HTTPServer(("0.0.0.0",8080),H).serve_forever()
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /get
              port: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: e2e-httpbin
  namespace: ${ns}
spec:
  selector:
    app: e2e-httpbin
  ports:
    - port: 80
      targetPort: 8080
`;
  const file = path.join(os.tmpdir(), `e2e-httpbin-${ns}.yaml`);
  fs.writeFileSync(file, manifest);
  await LogUtils.executeCommand("oc", ["apply", "-f", file]);
  await LogUtils.executeCommand("oc", [
    "-n",
    ns,
    "rollout",
    "status",
    "deployment/e2e-httpbin",
    "--timeout=180s",
  ]);
}

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
  let existing: EnvEntry[] = [];
  let envReadFailed = false;
  try {
    const raw = (
      await LogUtils.executeCommand("oc", [
        "-n",
        ns,
        "get",
        "sonataflow",
        "failswitch",
        "-o",
        "jsonpath={.spec.podTemplate.container.env}",
      ])
    ).trim();
    if (raw && raw !== "null") {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        existing = parsed as EnvEntry[];
      } else {
        envReadFailed = true;
        console.warn(
          `[failswitch] Expected env array from sonataflow spec, got ${typeof parsed}; skipping HTTPBIN patch to avoid env clobber`,
        );
      }
    }
  } catch (err) {
    envReadFailed = true;
    console.warn(
      `[failswitch] Failed to read existing env before HTTPBIN patch; skipping patch to avoid env clobber: ${String(err)}`,
    );
  }

  if (envReadFailed) {
    return;
  }

  const idx = existing.findIndex((entry) => entry.name === "HTTPBIN");
  if (idx >= 0) {
    existing[idx] = { name: "HTTPBIN", value };
  } else {
    existing.push({ name: "HTTPBIN", value });
  }

  const patch = JSON.stringify({
    spec: { podTemplate: { container: { env: existing } } },
  });
  console.log("patching HTTPBIN in sonataflow resource to", value);
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
  await LogUtils.executeCommand("oc", [
    "-n",
    ns,
    "rollout",
    "restart",
    "deployment",
    "failswitch",
  ]);
  // 60s gives the restarted deployment enough time to reconcile in CI and avoids flaky 5s pod-ready polling loops.
  await LogUtils.executeCommand("oc", [
    "-n",
    ns,
    "rollout",
    "status",
    "deployment",
    "failswitch",
    "--timeout=60s",
  ]);
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
