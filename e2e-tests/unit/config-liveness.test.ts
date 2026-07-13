import { describe, expect, it } from "vitest";

import { appConfigMatchesExpected } from "../playwright/utils/authentication-providers/rhdh-deployment/config-liveness";
import {
  buildDeploymentLabelSelector,
  labelSelectorFromMatchLabels,
} from "../playwright/utils/authentication-providers/rhdh-deployment/deployment-labels";

describe("deployment-labels", () => {
  it("builds the standard backstage Deployment label selector", () => {
    expect(buildDeploymentLabelSelector("rhdh")).toBe(
      "app.kubernetes.io/name=backstage,app.kubernetes.io/instance=rhdh",
    );
  });

  it("joins matchLabels into a selector", () => {
    expect(labelSelectorFromMatchLabels({ a: "1", b: "2" })).toBe("a=1,b=2");
  });
});

describe("appConfigMatchesExpected", () => {
  it("returns true when remote YAML matches expected config", () => {
    const expected = {
      auth: {
        providers: {
          github: {
            production: {
              sessionDuration: "3days",
              disableIdentityResolution: true,
            },
          },
        },
        autologout: { enabled: true },
      },
    };

    expect(
      appConfigMatchesExpected(
        `
auth:
  providers:
    github:
      production:
        sessionDuration: 3days
        disableIdentityResolution: true
  autologout:
    enabled: true
`,
        expected,
      ),
    ).toBe(true);
  });

  it("returns false when a critical auth key differs", () => {
    expect(
      appConfigMatchesExpected(
        `
auth:
  providers:
    github:
      production:
        sessionDuration: 3days
`,
        {
          auth: {
            providers: {
              github: {
                production: {
                  sessionDuration: "1day",
                },
              },
            },
          },
        },
      ),
    ).toBe(false);
  });
});
