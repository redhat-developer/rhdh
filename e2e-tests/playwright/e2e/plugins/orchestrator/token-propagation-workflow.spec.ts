import { execSync } from "child_process";
import { expect, test } from "@playwright/test";
import { Common } from "../../../utils/common";
import { RhdhAuthApiHack } from "../../../support/api/rhdh-auth-api-hack";
import { skipIfJobName } from "../../../utils/helper";
import { JOB_NAME_PATTERNS } from "../../../utils/constants";

interface WorkflowNode {
  name: string;
  errorMessage: string | null;
  exit: string | null;
}

interface WorkflowInstance {
  state: string;
  workflowdata: {
    result: {
      completedWith: string;
      message: string;
    };
  };
  nodes: WorkflowNode[];
  serviceUrl?: string;
}

/**
 * Decode a base64-encoded environment variable.
 */
function decodeEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return Buffer.from(value, "base64").toString();
}

test.describe("Token propagation workflow API tests", () => {
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP)); // skipping orchestrator tests on OSD-GCP due to infra not being installed
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.GKE)); // skipping orchestrator tests on GKE - plugins disabled
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.AKS)); // skipping orchestrator tests on AKS - plugins disabled
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.EKS)); // skipping orchestrator tests on EKS - plugins disabled
  test.skip(() => skipIfJobName(JOB_NAME_PATTERNS.OPERATOR)); // skipping orchestrator tests on Operator - infra not installed

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "orchestrator",
    });
  });

  test("Token propagation workflow executes successfully via API", async ({
    page,
  }) => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes for workflow execution + polling

    // 1. Login via page (hybrid approach for Backstage token)
    const common = new Common(page);
    await common.loginAsKeycloakUser();

    // 2. Get backstage identity token
    const backstageToken = await RhdhAuthApiHack.getToken(page);

    // 3. Get Keycloak OIDC access token via password grant
    const kcBaseUrl = decodeEnvVar("KEYCLOAK_AUTH_BASE_URL");
    const kcRealm = decodeEnvVar("KEYCLOAK_AUTH_REALM");
    const kcClientId = decodeEnvVar("KEYCLOAK_AUTH_CLIENTID");
    const kcClientSecret = decodeEnvVar("KEYCLOAK_AUTH_CLIENT_SECRET");

    const username = process.env.GH_USER_ID;
    const password = process.env.GH_USER_PASS;
    if (!username || !password) {
      throw new Error("GH_USER_ID and GH_USER_PASS must be set");
    }

    const tokenUrl = `${kcBaseUrl}/auth/realms/${kcRealm}/protocol/openid-connect/token`;

    const tokenResponse = await page.request.post(tokenUrl, {
      form: {
        grant_type: "password",
        client_id: kcClientId,
        client_secret: kcClientSecret,
        username,
        password,
        scope: "openid",
      },
    });
    if (!tokenResponse.ok()) {
      console.error(
        `Keycloak token request failed: ${tokenResponse.status()} ${await tokenResponse.text()}`,
      );
    }
    expect(tokenResponse.ok()).toBeTruthy();
    const tokenBody = await tokenResponse.json();
    const oidcToken = tokenBody.access_token;
    expect(oidcToken).toBeTruthy();

    // 4. Execute token-propagation workflow via API
    const executeResponse = await page.request.post(
      `/api/orchestrator/v2/workflows/token-propagation/execute`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${backstageToken}`,
        },
        data: {
          inputData: {},
          authTokens: [
            { provider: "OAuth2", token: oidcToken },
            {
              provider: "SimpleBearerToken",
              token: "test-simple-bearer-token-value",
            },
          ],
        },
      },
    );
    if (!executeResponse.ok()) {
      console.error(
        `Workflow execution failed: ${executeResponse.status()} ${await executeResponse.text()}`,
      );
    }
    expect(executeResponse.ok()).toBeTruthy();
    const { id: instanceId } = await executeResponse.json();
    expect(instanceId).toBeTruthy();
    console.log(`Workflow instance started: ${instanceId}`);

    // 5. Poll for workflow completion (up to 150 seconds)
    const maxPolls = 30;
    const pollInterval = 5000; // 5 seconds
    let finalState = "";
    let statusBody: WorkflowInstance = {} as WorkflowInstance;

    for (let poll = 1; poll <= maxPolls; poll++) {
      const statusResponse = await page.request.get(
        `/api/orchestrator/v2/workflows/instances/${instanceId}`,
        {
          headers: {
            Authorization: `Bearer ${backstageToken}`,
          },
        },
      );
      expect(statusResponse.ok()).toBeTruthy();
      statusBody = await statusResponse.json();
      finalState = statusBody.state;

      if (finalState === "COMPLETED") {
        console.log(`Workflow completed successfully after ${poll} polls`);
        break;
      }

      if (finalState === "ERROR") {
        console.error(
          "Workflow failed with ERROR state:",
          JSON.stringify(statusBody),
        );
        break;
      }

      console.log(`Workflow status: ${finalState} (poll ${poll}/${maxPolls})`);
      await page.waitForTimeout(pollInterval);
    }

    expect(finalState).toBe("COMPLETED");

    // 6. Verify workflow output data
    expect(statusBody.workflowdata.result.completedWith).toBe("success");
    expect(statusBody.workflowdata.result.message).toContain(
      "Token propagated",
    );

    // 7. Verify all 3 token path nodes + extractUser completed without error
    const nodes = statusBody.nodes;
    const expectedNodes = [
      "getWithBearerTokenSecurityScheme",
      "getWithOtherBearerTokenSecurityScheme",
      "getWithSimpleBearerTokenSecurityScheme",
      "extractUser",
    ];
    for (const nodeName of expectedNodes) {
      const node = nodes.find((n: WorkflowNode) => n.name === nodeName);
      expect(node, `Node '${nodeName}' should exist`).toBeDefined();
      expect(
        node.errorMessage,
        `Node '${nodeName}' should have no error`,
      ).toBeNull();
      expect(
        node.exit,
        `Node '${nodeName}' should have completed`,
      ).not.toBeNull();
    }

    // 8. Verify sample-server pod logs for token propagation evidence
    if (process.env.IS_OPENSHIFT === "true") {
      const serviceUrl = statusBody.serviceUrl || "";
      const nsMatch = serviceUrl.match(/token-propagation\.([^:/]+)/);
      const namespace = nsMatch?.[1] || process.env.NAME_SPACE || "";

      if (namespace) {
        // Validate namespace conforms to Kubernetes DNS-1123 label format
        // to prevent command injection via shell metacharacters
        if (!/^[a-z0-9-]+$/.test(namespace)) {
          throw new Error(
            `Invalid namespace format: "${namespace}". Must contain only lowercase alphanumeric characters and hyphens.`,
          );
        }

        const sampleServerLogs = execSync(
          `oc logs -l app=sample-server -n ${namespace} --tail=200`,
          { encoding: "utf-8", timeout: 30000 },
        );

        expect(
          sampleServerLogs,
          "Sample-server should log /first endpoint request",
        ).toContain("Headers for first");
        expect(
          sampleServerLogs,
          "Sample-server should log /other endpoint request",
        ).toContain("Headers for other");
        expect(
          sampleServerLogs,
          "Sample-server should log /simple endpoint request",
        ).toContain("Headers for simple");

        console.log(
          "Sample-server log verification passed for all 3 endpoints",
        );
      } else {
        console.log(
          "Skipping sample-server log verification: namespace not found",
        );
      }
    } else {
      console.log(
        "Skipping sample-server log verification: not running on OpenShift",
      );
    }
  });
});
