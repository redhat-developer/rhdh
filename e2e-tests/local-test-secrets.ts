#!/usr/bin/env node

import { closeSync, mkdirSync, mkdtempSync, readSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  decodeSecretStream,
  removeProviderEnvironmentVariables,
  runChild,
} from "@red-hat-developer-hub/e2e-test-utils/secrets";

const MAX_STREAM_BYTES = 64 * 1024 * 1024;
const CALLER_VARIABLES = [
  "BASE_URL",
  "K8S_CLUSTER_URL",
  "K8S_CLUSTER_TOKEN",
  "NAME_SPACE",
  "NAME_SPACE_RBAC",
  "NAME_SPACE_RUNTIME",
];
const CERTIFICATES = new Set([
  "azure_db_certificates_pem",
  "azure_db_certificates__dot__pem",
  "rds_db_certificates_pem",
  "rds_db_certificates__dot__pem",
]);
const CONTROLS =
  /^(?:BASH|BW_|DYLD_|LD_|NODE_|RHDH_E2E_|RHDH_LOCAL_|RHDH_SECRET_|EPHEMERAL_CLUSTER_ADMIN_|NAME_SPACE)|^(?:BASE_URL|K8S_CLUSTER_URL|K8S_CLUSTER_TOKEN|PATH|HOME|SHELL|ENV|SHELLOPTS|IFS|CDPATH|GLOBIGNORE|PS4|DIR|SHARED_DIR|ARTIFACT_DIR)$/u;
const ALIASES = {
  RHBK_BASE_URL: "AUTH_PROVIDERS_RHBK_BASE_URL",
  RHBK_CLIENT_SECRET: "AUTH_PROVIDERS_RHBK_CLIENT_SECRET",
  RHBK_CLIENT_ID: "AUTH_PROVIDERS_RHBK_CLIENT_ID",
  RHBK_REALM: "AUTH_PROVIDERS_RHBK_REALM",
  DEFAULT_USER_PASSWORD: "AUTH_PROVIDERS_DEFAULT_USER_PASSWORD",
  DEFAULT_USER_PASSWORD_2: "AUTH_PROVIDERS_DEFAULT_USER_PASSWORD_2",
};

function readEntries() {
  if (process.env.RHDH_E2E_SECRET_FD !== "3") {
    throw new Error("Run local-test.sh to provide the secret stream");
  }
  // Bound the read before allocating or decoding untrusted lengths.
  const input = Buffer.allocUnsafe(MAX_STREAM_BYTES + 1);
  let offset = 0;
  try {
    while (offset < input.length) {
      const bytesRead = readSync(3, input, offset, input.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset === input.length) throw new Error("Secret stream is too large");
    return decodeSecretStream(input.subarray(0, offset));
  } finally {
    closeSync(3);
  }
}

function testEnvironment(entries: ReturnType<typeof decodeSecretStream>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...Object.fromEntries(
      entries
        .filter(({ name }) => !CONTROLS.test(name) && !CERTIFICATES.has(name))
        .map(({ name, value }) => [name, value]),
    ),
    REDIS_USERNAME: "temp",
    REDIS_PASSWORD: "test123",
  };
  for (const variable of CALLER_VARIABLES) {
    const value = process.env[`RHDH_LOCAL_TEST_CALLER_${variable}`];
    if (value !== undefined) environment[variable] = value;
  }
  for (const [target, source] of Object.entries(ALIASES)) {
    delete environment[target];
    if (environment[source] !== undefined) environment[target] = environment[source];
  }
  removeProviderEnvironmentVariables(environment);
  for (const name of Object.keys(environment)) {
    if (
      name.startsWith("RHDH_LOCAL_TEST_") ||
      name.startsWith("EPHEMERAL_CLUSTER_ADMIN_") ||
      name === "RHDH_E2E_SECRET_FD" ||
      CERTIFICATES.has(name)
    ) {
      delete environment[name];
    }
  }

  return environment;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error("Wrapped test command is required");
  const entries = readEntries();
  const azure = entries.filter(({ name }) =>
    ["azure_db_certificates_pem", "azure_db_certificates__dot__pem"].includes(name),
  );
  if (azure.length > 1) throw new Error("Secret stream contains conflicting Azure certificates");
  const environment = testEnvironment(entries);
  const root = join(import.meta.dirname, ".local-test");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(root, "certificates."));
  try {
    delete environment.AZURE_DB_CERTIFICATES_PATH;
    if (azure.length === 1) {
      environment.AZURE_DB_CERTIFICATES_PATH = join(directory, "azure-db-certificates.pem");
      writeFileSync(environment.AZURE_DB_CERTIFICATES_PATH, azure[0].value, { mode: 0o600 });
    }
    environment.RDS_DB_CERTIFICATES_PATH = join(directory, "rds-global-bundle.pem");
    const downloaded = await runChild(
      "curl",
      [
        "-fsSL",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--retry",
        "3",
        "--max-time",
        "30",
        "-o",
        environment.RDS_DB_CERTIFICATES_PATH,
        "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem",
      ],
      process.env,
    );
    if (downloaded !== 0) {
      rmSync(environment.RDS_DB_CERTIFICATES_PATH, { force: true });
      if ([129, 130, 143].includes(downloaded)) return downloaded;
      console.error(
        "WARNING: could not download the AWS RDS global certificate bundle; RDS TLS tests will not run",
      );
    }
    return await runChild(command, args, environment);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Local test secret preparation or command execution failed: ${message}`);
  process.exitCode = 1;
}
