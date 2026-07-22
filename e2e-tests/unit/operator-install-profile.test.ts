import { describe, expect, it } from "vitest";

import {
  BACKSTAGE_CR_API_VERSION,
  OPERATOR_BACKEND_SECRET,
  applyOperatorInstallProfileToAppConfig,
  applyOperatorInstallProfileToCr,
  type BackstageCrLike,
  type YamlRecord,
} from "../playwright/utils/operator-install-profile";

describe("OperatorInstallProfile", () => {
  it("pins the Backstage CR API version and empty flavours", () => {
    const cr: BackstageCrLike = {
      apiVersion: "rhdh.redhat.com/v1alpha4",
      kind: "Backstage",
      metadata: { name: "rhdh" },
      spec: { application: { extraEnvs: { envs: [] } } },
    };

    applyOperatorInstallProfileToCr(cr);

    expect(cr.apiVersion).toBe(BACKSTAGE_CR_API_VERSION);
    expect(cr.spec.flavours).toEqual([]);
  });

  it("injects BACKEND_SECRET into auth-provider CR envs", () => {
    const cr: BackstageCrLike = {
      apiVersion: "rhdh.redhat.com/v1alpha4",
      kind: "Backstage",
      metadata: { name: "rhdh" },
      spec: {
        application: {
          extraEnvs: {
            envs: [{ name: "NODE_OPTIONS", value: "--no-node-snapshot" }],
          },
        },
      },
    };

    applyOperatorInstallProfileToCr(cr);

    expect(JSON.stringify(cr)).toContain(`"name":"BACKEND_SECRET"`);
    expect(JSON.stringify(cr)).toContain(`"value":"${OPERATOR_BACKEND_SECRET}"`);
  });

  it("rewrites auth app-config keys to BACKEND_SECRET and drops sqlite for operator", () => {
    const appConfig: YamlRecord = {
      backend: {
        auth: { keys: [{ secret: "temp" }] },
        database: { client: "better-sqlite3", connection: ":memory:" },
      },
    };

    applyOperatorInstallProfileToAppConfig(appConfig, "auth-providers");

    expect(JSON.stringify(appConfig)).toContain('{"secret":"${BACKEND_SECRET}"}');
    expect(JSON.stringify(appConfig)).not.toContain("better-sqlite3");
  });
});
