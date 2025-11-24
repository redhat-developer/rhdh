import { test } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Common } from "../../../utils/common";
import { Orchestrator } from "../../../support/pages/orchestrator";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

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
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.validateWorkflowAllRuns();
  });

  test("Failswitch workflow execution and test abort workflow", async () => {
    await uiHelper.openSidebar("Orchestrator");
    await orchestrator.selectFailSwitchWorkflowItem();
    await orchestrator.runFailSwitchWorkflow("Wait");
    await orchestrator.abortWorkflow();
  });

//   test("Failswitch workflow execution and test rerunning from failure point", async () => {
//     test.skip(true);
//     const { execSync } = require('child_process');
//     let correctValue = "quarkus.rest-client.httpbin_yaml.url=${HTTPBIN:https://httpbin.org/}";
//     let patchIncorrectValue = execSync(`oc -n ${process.env.RHDH_NAMESPACE} patch sonataflow failswitch --type merge -p '{"spec": { "podTemplate": { "container": { "env": [{"name": "HTTPBIN",  "value": "https://httpbn.org/"}]}}}}'`).toString().trim();
//     console.log(patchIncorrectValue);

//     let reloadPod = execSync(`oc rollout restart deployment failswitch -n ${process.env.RHDH_NAMESPACE}`).toString().trim();
//     console.log(reloadPod);

//     let waitPodRunningResult = execSync(`oc wait --for=condition=ready pod -l app.kubernetes.io/name=failswitch -n ${process.env.RHDH_NAMESPACE} --timeout=120s`).toString().trim();
//     console.log(waitPodRunningResult);

//     await uiHelper.openSidebar("Orchestrator");
//     await orchestrator.selectFailSwitchWorkflowItem();
//     await orchestrator.runFailSwitchWorkflow("Wait");
//     await orchestrator.validateWorkflowStatus("Failed");

//     let patchCorrectValue = execSync(`oc -n ${process.env.RHDH_NAMESPACE} patch sonataflow failswitch --type merge -p '{"spec": { "podTemplate": { "container": { "env": [{"name": "HTTPBIN",  "value": "https://httpbin.org/"}]}}}}'`).toString().trim();
//     console.log(patchCorrectValue);

//     let reloadPodsResult = execSync(`oc rollout restart deployment failswitch -n ${process.env.RHDH_NAMESPACE}`).toString().trim();
//     console.log(reloadPodsResult);

//     let waitPodsRunningResult = execSync(`oc wait --for=condition=ready pod -l app.kubernetes.io/name=failswitch -n ${process.env.RHDH_NAMESPACE} --timeout=120s`).toString().trim();
//     console.log(waitPodsRunningResult);

//     await orchestrator.reRunOnFailure("From failure point");
//     await orchestrator.validateWorkflowStatus("Completed");
//   });
});
