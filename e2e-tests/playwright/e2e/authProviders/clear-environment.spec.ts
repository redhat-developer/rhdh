import { test } from "sealights-playwright-plugin";
import * as constants from "../../utils/authenticationProviders/constants";
import { KubeClient } from "../../utils/kube-client";

test.describe("Setup namespace and configure environment for RHDH", () => {
  test("Delete namespace", async () => {
    await new KubeClient().deleteNamespaceAndWait(
      constants.AUTH_PROVIDERS_NAMESPACE,
    );
  });
});
