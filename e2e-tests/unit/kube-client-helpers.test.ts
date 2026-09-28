import { describe, expect, it } from "vitest";

import {
  buildEnvFromSecretPatch,
  envVarsNotFromSecret,
} from "../playwright/utils/kube-client/helpers";

const SECRET = "rhdh-postgresql";
const ENV = "/spec/template/spec/containers/1/env";

/** An env var that reads the same-named key of `secret`. */
function fromSecret(name: string, secret = SECRET) {
  return { name, valueFrom: { secretKeyRef: { name: secret, key: name } } };
}

describe("envVarsNotFromSecret", () => {
  it("selects a variable the chart set as a literal value", () => {
    const existing = [{ name: "POSTGRES_USER", value: "postgres" }];

    expect(envVarsNotFromSecret(existing, SECRET, ["POSTGRES_USER"])).toEqual(["POSTGRES_USER"]);
  });

  it("selects a variable that reads the same key from another secret", () => {
    const existing = [fromSecret("POSTGRES_PASSWORD", "other-secret")];

    expect(envVarsNotFromSecret(existing, SECRET, ["POSTGRES_PASSWORD"])).toEqual([
      "POSTGRES_PASSWORD",
    ]);
  });

  it("selects a variable the container does not define", () => {
    expect(envVarsNotFromSecret(undefined, SECRET, ["POSTGRES_DB"])).toEqual(["POSTGRES_DB"]);
  });

  it("skips variables that already read from the secret", () => {
    const existing = [fromSecret("POSTGRES_HOST"), { name: "POSTGRES_USER", value: "postgres" }];

    expect(envVarsNotFromSecret(existing, SECRET, ["POSTGRES_HOST", "POSTGRES_USER"])).toEqual([
      "POSTGRES_USER",
    ]);
  });
});

describe("buildEnvFromSecretPatch", () => {
  it("removes the existing literal before adding the secret reference", () => {
    const existing = [
      { name: "NODE_OPTIONS", value: "--no-node-snapshot" },
      { name: "POSTGRES_USER", value: "postgres" },
    ];

    expect(buildEnvFromSecretPatch(1, existing, SECRET, ["POSTGRES_USER"])).toEqual([
      { op: "remove", path: `${ENV}/1` },
      { op: "add", path: `${ENV}/-`, value: fromSecret("POSTGRES_USER") },
    ]);
  });

  it("removes every duplicate entry, in reverse order", () => {
    const existing = [
      { name: "POSTGRES_HOST", value: "a" },
      { name: "NODE_ENV", value: "production" },
      { name: "POSTGRES_HOST", value: "b" },
    ];

    expect(buildEnvFromSecretPatch(1, existing, SECRET, ["POSTGRES_HOST"])).toEqual([
      { op: "remove", path: `${ENV}/2` },
      { op: "remove", path: `${ENV}/0` },
      { op: "add", path: `${ENV}/-`, value: fromSecret("POSTGRES_HOST") },
    ]);
  });

  it("creates the env array first when the container has none", () => {
    expect(buildEnvFromSecretPatch(1, undefined, SECRET, ["POSTGRES_DB"])).toEqual([
      { op: "add", path: ENV, value: [] },
      { op: "add", path: `${ENV}/-`, value: fromSecret("POSTGRES_DB") },
    ]);
  });
});
