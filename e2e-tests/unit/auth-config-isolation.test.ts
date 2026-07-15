import { describe, expect, it, vi } from "vitest";

import { isRetryableConnectionError } from "../playwright/support/auth/provider-auth";
import {
  configureGithubSessionDuration,
  configureMicrosoftSessionDuration,
  configureOidcSessionDuration,
  type AuthConfigActions,
} from "../playwright/utils/authentication-providers/rhdh-deployment/auth";
import { isKubernetesConflictError } from "../playwright/utils/errors";

function captureActions(): AuthConfigActions & { props: Record<string, unknown> } {
  const props: Record<string, unknown> = {};
  return {
    props,
    setDynamicPluginEnabled: vi.fn<(pluginName: string, enabled: boolean) => void>(),
    setAppConfigProperty: (path: string, value: unknown): void => {
      props[path] = value;
    },
  };
}

describe("isKubernetesConflictError", () => {
  it("detects top-level statusCode 409 from the Kubernetes client HttpError", () => {
    expect(isKubernetesConflictError({ statusCode: 409 })).toBe(true);
  });

  it("detects nested response.statusCode 409", () => {
    expect(isKubernetesConflictError({ response: { statusCode: 409 } })).toBe(true);
  });

  it("rejects non-conflict errors", () => {
    expect(isKubernetesConflictError({ statusCode: 500 })).toBe(false);
    expect(isKubernetesConflictError(new Error("HTTP request failed"))).toBe(false);
  });
});

describe("isRetryableConnectionError", () => {
  it("retries connection drops and network changes", () => {
    expect(isRetryableConnectionError(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(true);
    expect(isRetryableConnectionError(new Error("net::ERR_NETWORK_CHANGED"))).toBe(true);
  });

  it("retries ERR_ABORTED only for page.goto navigations", () => {
    expect(
      isRetryableConnectionError(
        new Error(
          'page.goto: net::ERR_ABORTED at https://example.com/\nCall log:\n  - navigating to "https://example.com/"',
        ),
      ),
    ).toBe(true);
    expect(isRetryableConnectionError(new Error("net::ERR_ABORTED"))).toBe(false);
    expect(isRetryableConnectionError(new Error("AbortError: The operation was aborted"))).toBe(
      false,
    );
  });

  it("does not retry unrelated navigation failures", () => {
    expect(isRetryableConnectionError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toBe(false);
    expect(isRetryableConnectionError(new Error("Timeout 30000ms exceeded"))).toBe(false);
  });
});

describe("configure*SessionDuration", () => {
  it("pins a github username resolver with sessionDuration so earlier resolvers cannot leak", () => {
    const actions = captureActions();
    configureGithubSessionDuration(actions, "3days");

    expect(actions.props["auth.providers.github.production.signIn.resolvers"]).toEqual([
      {
        resolver: "usernameMatchingUserEntityName",
        dangerouslyAllowSignInWithoutUserInCatalog: false,
      },
    ]);
    expect(actions.props["auth.providers.github.production.sessionDuration"]).toBe("3days");
  });

  it("pins an oidc profile-email resolver with sessionDuration", () => {
    const actions = captureActions();
    configureOidcSessionDuration(actions, "3days");

    expect(actions.props["auth.providers.oidc.production.signIn.resolvers"]).toEqual([
      {
        resolver: "emailMatchingUserEntityProfileEmail",
        dangerouslyAllowSignInWithoutUserInCatalog: false,
      },
    ]);
    expect(actions.props["auth.providers.oidc.production.sessionDuration"]).toBe("3days");
  });

  it("pins a microsoft profile-email resolver with sessionDuration", () => {
    const actions = captureActions();
    configureMicrosoftSessionDuration(actions, "3days");

    expect(actions.props["auth.providers.microsoft.production.signIn.resolvers"]).toEqual([
      {
        resolver: "emailMatchingUserEntityProfileEmail",
        dangerouslyAllowSignInWithoutUserInCatalog: false,
      },
    ]);
    expect(actions.props["auth.providers.microsoft.production.sessionDuration"]).toBe("3days");
  });
});
