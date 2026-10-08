import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { writeSecretStream } from "@red-hat-developer-hub/e2e-test-utils/secrets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const environmentFile = join(repository, ".ci/pipelines/env_variables.sh");
const source = readFileSync(environmentFile, "utf8");
const rawNames = [
  ...new Set(
    [...source.matchAll(/\$\(cat \/tmp\/secrets\/([A-Z0-9_]+)\)/gu)].map((match) => match[1]),
  ),
];
const variables = [
  ...new Set([...source.matchAll(/^([A-Z0-9_]+)=/gmu)].map((match) => match[1])),
  "NAME_SPACE",
  "NAME_SPACE_RBAC",
  "NAME_SPACE_RUNTIME",
  "NAME_SPACE_POSTGRES_DB",
];
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rhdh-ci-secret-compatibility-"));
  for (const directory of ["ci", "local", "shared", "artifacts"]) mkdirSync(join(root, directory));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setup(mount: string, failedDownload = false) {
  // Redirect only the fixed container paths to this test's private fixtures.
  // The actual env_variables.sh is sourced without modifying its assignments.
  return spawnSync(
    "/bin/bash",
    [
      "-euc",
      `
cat() { command cat "$MOUNT/\${1##*/}"; }
curl() { printf 'current-public-aws-ca' > "$TEST_RDS_FILE"; return "$DOWNLOAD_STATUS"; }
rm() {
  [[ "$1" == -f && "$2" == /tmp/rds-global-bundle.pem ]]
  command rm -f "$TEST_RDS_FILE"
}
source "$ENVIRONMENT_FILE"
node -e 'console.log(JSON.stringify(Object.fromEntries(JSON.parse(process.env.TEST_VARIABLES).map(key => [key, process.env[key]]))))'
`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        MOUNT: mount,
        ENVIRONMENT_FILE: environmentFile,
        DIR: join(repository, ".ci/pipelines"),
        TEST_VARIABLES: JSON.stringify(variables),
        TEST_RDS_FILE: join(root, "aws-ca.pem"),
        DOWNLOAD_STATUS: failedDownload ? "22" : "0",
        SHARED_DIR: join(root, "shared"),
        ARTIFACT_DIR: join(root, "artifacts"),
        NAME_SPACE: "caller-showcase",
        K8S_CLUSTER_URL: "https://caller-cluster.test",
        K8S_CLUSTER_TOKEN: "fresh-caller-token",
        POSTGRESQL_IMAGE_REGISTRY: "example.test",
        POSTGRESQL_IMAGE_REPO: "postgresql",
        POSTGRESQL_IMAGE_TAG: "custom-tag",
      },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

async function fixtures() {
  const entries = rawNames.map((name) => ({ name, value: `${name}-synthetic` }));
  entries.push(
    { name: "K8S_CLUSTER_TOKEN", value: "profile-token" },
    { name: "NAME_SPACE", value: "profile-namespace" },
  );
  for (const { name, value } of entries) writeFileSync(join(root, "ci", name), value);
  writeFileSync(join(root, "ci/azure-db-certificates.pem"), "synthetic-azure-ca");
  entries.push(
    { name: "azure_db_certificates__dot__pem", value: "synthetic-azure-ca" },
    { name: "rds_db_certificates_pem", value: "stale-stored-aws-ca" },
  );
  const chunks: Buffer[] = [];
  await writeSecretStream(
    new Writable({
      write(chunk: Uint8Array, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    entries,
  );
  execFileSync(
    process.execPath,
    [join(repository, "e2e-tests/decode-secret-stream.ts"), join(root, "local")],
    {
      input: Buffer.concat(chunks),
    },
  );
}

describe("original CI secret sourcing", () => {
  it("produces the same environment from CI files and decoded Bitwarden files", async () => {
    await fixtures();
    const ci = setup(join(root, "ci"));
    const local = setup(join(root, "local"));
    expect(ci.status).toBe(0);
    expect(local.status).toBe(0);
    expect(ci.stderr).toBe("");
    expect(local.stderr).toBe("");
    expect(JSON.parse(local.stdout)).toEqual(JSON.parse(ci.stdout));
    const environment: unknown = JSON.parse(local.stdout);
    expect(environment).toHaveProperty("NAME_SPACE", "caller-showcase");
    expect(environment).toHaveProperty("K8S_CLUSTER_TOKEN", "fresh-caller-token");
    expect(environment).toHaveProperty("POSTGRESQL_IMAGE_TAG", "custom-tag");
    expect(environment).toHaveProperty(
      "RHBK_CLIENT_SECRET",
      "AUTH_PROVIDERS_RHBK_CLIENT_SECRET-synthetic",
    );
    expect(environment).toHaveProperty(
      "AUTH_PROVIDERS_GH_USER_PASSWORD",
      "AUTH_PROVIDERS_GH_USER_PASSWORD-synthetic",
    );
    expect(environment).toHaveProperty(
      "GITHUB_APP_PRIVATE_KEY_RBAC",
      "GITHUB_APP_PRIVATE_KEY_OPERATOR-synthetic",
    );
    expect(environment).toHaveProperty(
      "GITHUB_APP_CLIENT_SECRET_RBAC",
      "GITHUB_APP_CLIENT_SECRET_OPERATOR-synthetic",
    );
    for (const [suffix, credential] of [
      ["1", "3"],
      ["2", "AKS"],
      ["3", "EKS"],
      ["4", "GKE"],
      ["5", "HELM"],
    ]) {
      const field =
        credential === "3" ? "GITHUB_APP_3_PRIVATE_KEY" : `GITHUB_APP_PRIVATE_KEY_${credential}`;
      expect(environment).toHaveProperty(`GITHUB_APP_PRIVATE_KEY_${suffix}`, `${field}-synthetic`);
    }
    for (const [suffix, credential] of [
      ["1", "OPERATOR"],
      ["2", "OSD"],
      ["3", "HELM_PR"],
      ["4", "HELM_PR_2"],
      ["5", "HELM_PR_3"],
    ]) {
      expect(environment).toHaveProperty(
        `GITHUB_APP_PRIVATE_KEY_RBAC_${suffix}`,
        `GITHUB_APP_PRIVATE_KEY_${credential}-synthetic`,
      );
    }
    expect(environment).toHaveProperty("AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID-synthetic");
    expect(environment).toHaveProperty("GKE_CERT_NAME", "GKE_CERT_NAME-synthetic");
    expect(environment).toHaveProperty(
      "AZURE_DB_CERTIFICATES_PATH",
      "/tmp/secrets/azure-db-certificates.pem",
    );
    expect(readFileSync(join(root, "local/azure-db-certificates.pem"), "utf8")).toBe(
      "synthetic-azure-ca",
    );
    expect(readFileSync(join(root, "aws-ca.pem"), "utf8")).toBe("current-public-aws-ca");
  });

  it("removes a failed public CA download without using the stored bundle", async () => {
    await fixtures();
    const result = setup(join(root, "local"), true);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RDS TLS tests will not run");
    expect(() => readFileSync(join(root, "aws-ca.pem"))).toThrow(/ENOENT/u);
  });
});
