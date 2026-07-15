import { describe, expect, it, vi } from "vitest";

import { isRetryableConnectionError } from "../playwright/support/auth/provider-auth";
import {
  configureGithubSessionDuration,
  configureMicrosoftSessionDuration,
  configureOidcAutologout,
  configureOidcSessionDuration,
  type AuthConfigActions,
} from "../playwright/utils/authentication-providers/rhdh-deployment/auth";
import { isKubernetesConflictError, isKubernetesNotFoundError } from "../playwright/utils/errors";
import { wrapKubernetesError } from "../playwright/utils/kube-client/helpers";

function captureActions(): AuthConfigActions & {
  props: Record<string, unknown>;
  deleted: string[];
} {
  const props: Record<string, unknown> = {};
  const deleted: string[] = [];
  return {
    props,
    deleted,
    setDynamicPluginEnabled: vi.fn<(pluginName: string, enabled: boolean) => void>(),
    setAppConfigProperty: (path: string, value: unknown): void => {
      props[path] = value;
    },
    deleteAppConfigProperty: (path: string): void => {
      deleted.push(path);
      delete props[path];
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

describe("isKubernetesNotFoundError", () => {
  it("detects top-level and nested 404", () => {
    expect(isKubernetesNotFoundError({ statusCode: 404 })).toBe(true);
    expect(isKubernetesNotFoundError({ response: { statusCode: 404 } })).toBe(true);
  });

  it("rejects non-404 errors", () => {
    expect(isKubernetesNotFoundError({ statusCode: 409 })).toBe(false);
  });
});

describe("wrapKubernetesError", () => {
  it("includes operation context and status detail", () => {
    const wrapped = wrapKubernetesError("Failed to delete pod foo", {
      response: { statusCode: 500, statusMessage: "Internal Server Error" },
    });
    expect(wrapped.message).toContain("Failed to delete pod foo");
    expect(wrapped.message).toContain("HTTP 500");
    expect(wrapped.cause).toEqual({
      response: { statusCode: 500, statusMessage: "Internal Server Error" },
    });
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

describe("configureOidcAutologout", () => {
  it("pins email resolver, enables autologout, and clears leftover sessionDuration", () => {
    const actions = captureActions();
    actions.setAppConfigProperty("auth.providers.oidc.production.sessionDuration", "3days");

    configureOidcAutologout(actions, {
      idleTimeoutMinutes: 0.5,
      promptBeforeIdleSeconds: 5,
    });

    expect(actions.props["auth.providers.oidc.production.signIn.resolvers"]).toEqual([
      {
        resolver: "emailMatchingUserEntityProfileEmail",
        dangerouslyAllowSignInWithoutUserInCatalog: false,
      },
    ]);
    expect(actions.deleted).toContain("auth.providers.oidc.production.sessionDuration");
    expect(actions.props["auth.providers.oidc.production.sessionDuration"]).toBeUndefined();
    expect(actions.props["auth.autologout.enabled"]).toBe(true);
    expect(actions.props["auth.autologout.idleTimeoutMinutes"]).toBe(0.5);
    expect(actions.props["auth.autologout.promptBeforeIdleSeconds"]).toBe(5);
  });
});
