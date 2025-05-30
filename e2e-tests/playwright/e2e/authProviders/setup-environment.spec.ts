import { test } from "sealights-playwright-plugin";
import * as constants from "../../utils/authenticationProviders/constants";
import {
  ensureEnvSecretExists,
  ensureNewPolicyConfigMapExists,
} from "../../utils/helper";
import { KubeClient } from "../../utils/kube-client";

test.describe("Setup namespace and configure environment for RHDH", () => {
  test("Create namespace", async () => {
    const k = new KubeClient();
    await k.createNamespaceIfNotExists(constants.AUTH_PROVIDERS_NAMESPACE);
  });

  test("Create rbac-policy configMap", async () => {
    await ensureNewPolicyConfigMapExists(
      "rbac-policy",
      constants.AUTH_PROVIDERS_NAMESPACE,
    );
  });

  test("Create rhdh-secrets secret ", async () => {
    await ensureEnvSecretExists(
      "rhdh-secrets",
      constants.AUTH_PROVIDERS_NAMESPACE,
    );
  });
});
