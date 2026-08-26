import { useRhdhBaseURL } from "../coverage/test";
import { AuthProviderHarness } from "./auth-provider-harness";

/**
 * Create an auth-provider harness and bind its URL into Playwright
 * (`baseURL` + worker-scoped `workerBaseURL`).
 *
 * Must be called at file top level — Playwright rejects worker-scoped
 * `test.use` inside `describe` / hooks.
 */
export function createAuthProviderHarness(
  namespace: string,
  instanceName = "rhdh",
): AuthProviderHarness {
  const harness = AuthProviderHarness.create(namespace, instanceName);
  useRhdhBaseURL(harness.backstageUrl);
  return harness;
}
