import { test, expect } from "@support/coverage/test";

import { RuntimeHarness } from "../../support/harnesses/runtime-harness";
import { HomePage } from "../../support/pages/home-page";
import { getKubeApiErrorMessage } from "../../utils/kube-client/helpers";
import { ensureRuntimeDeployed } from "../../utils/runtime-deploy";

test.describe("Change app-config at e2e test runtime", () => {
  test.beforeAll(async () => {
    test.info().annotations.push(
      {
        type: "component",
        description: "configuration",
      },
      {
        type: "namespace",
        description: process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime",
      },
    );

    await ensureRuntimeDeployed();
  });

  test("Verify title change after ConfigMap modification", async ({ page }) => {
    const namespace = process.env.NAME_SPACE_RUNTIME ?? "showcase-runtime";
    const runtimeHarness = new RuntimeHarness(namespace);
    const dynamicTitle = generateDynamicTitle();
    try {
      await runtimeHarness.withAppTitle(dynamicTitle, async () => {
        await runtimeHarness.verifyGuestSession(page);
        await new HomePage(page).openHomeSidebar();
        await expect(page).toHaveTitle(new RegExp(dynamicTitle, "u"));
      });
    } catch (error) {
      throw new Error(`ConfigMap runtime change failed: ${getKubeApiErrorMessage(error)}`, {
        cause: error,
      });
    }
  });
});

function generateDynamicTitle() {
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/gu, "");
  return `New Title - ${timestamp}`;
}
