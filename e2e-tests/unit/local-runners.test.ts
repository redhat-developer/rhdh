import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { writeSecretStream } from "@red-hat-developer-hub/e2e-test-utils/secrets";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const prow = "https://prow.ci.openshift.org/view/gs/test-platform-results/logs/test-job/123";
const runArgs = ["-R", "example.com", "-r", "rhdh", "-t", "test", "-s"];
let root: string;
let env: NodeJS.ProcessEnv;

function mock(name: string, script: string) {
  writeFileSync(join(root, "bin", name), `#!/bin/bash\n${script}\n`, { mode: 0o700 });
}

function events() {
  return readFileSync(join(root, "events"), "utf8");
}

async function stream(entries: Array<{ name: string; value: string }>) {
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
  writeFileSync(join(root, "stream"), Buffer.concat(chunks));
}

function run(path: string, args: string[] = [], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync("/bin/bash", [join(root, path), ...args], {
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 10_000,
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "rhdh-local-runners-"));
  mkdirSync(join(root, "bin"));
  for (const path of [
    "e2e-tests/local-run.sh",
    "e2e-tests/local-run-container.sh",
    "e2e-tests/local-test.sh",
    "e2e-tests/local-test-secrets.ts",
    "e2e-tests/local-test-runtime.sh",
    "e2e-tests/local-secrets.sh",
    "e2e-tests/decode-secret-stream.ts",
    "e2e-tests/e2e-secrets.profile.json",
    "e2e-tests/ephemeral-cluster-secrets.profile.json",
    "e2e-tests/playwright/projects.json",
    ".ci/pipelines/lib/log.sh",
    ".ci/pipelines/ocp-cluster-claim-login.sh",
  ]) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repository, path), target);
  }
  symlinkSync(join(repository, "e2e-tests/node_modules"), join(root, "e2e-tests/node_modules"));
  symlinkSync(process.execPath, join(root, "bin/node"));
  writeFileSync(join(root, "events"), "");
  await stream([
    { name: "EPHEMERAL_CLUSTER_ADMIN_USERNAME", value: "synthetic-user" },
    { name: "EPHEMERAL_CLUSTER_ADMIN_PASSWORD", value: "synthetic-password" },
    { name: "NAME_SPACE", value: "profile-namespace" },
    { name: "BASE_URL", value: "https://profile.test" },
    { name: "K8S_CLUSTER_TOKEN", value: "profile-token" },
    { name: "azure_db_certificates_pem", value: "azure-ca" },
  ]);
  env = {
    PATH: `${join(root, "bin")}:/usr/bin:/bin`,
    HOME: root,
    TMPDIR: `${root}/`,
    EVENTS: join(root, "events"),
    TEST_STREAM: join(root, "stream"),
    BW_SESSION: "synthetic-session",
    RHDH_E2E_SECRETS_BIN: join(root, "bin/secrets"),
    BASE_URL: "https://example.test",
    NAME_SPACE: "local-showcase",
    RELEASE: join(root, "release"),
  };
  mock(
    "secrets",
    `
if [[ "$1" == --help ]]; then printf '%s\\n' --stream-secrets; exit; fi
printf 'secrets\\n' >> "$EVENTS"
[[ "\${FAIL_SECRETS:-}" != 1 ]] || exit 7
while [[ "$1" != -- ]]; do shift; done
shift
export RHDH_E2E_SECRET_FD=3
unset BW_SESSION NAME_SPACE BASE_URL K8S_CLUSTER_TOKEN
exec "$@" 3< "$TEST_STREAM"`,
  );
  mock("uname", "printf 'Linux\\n'");
  mock(
    "oc",
    `
printf 'oc %s\\n' "$*" >> "$EVENTS"
case "$*" in
  'whoami --show-server') printf 'https://cluster.test\\n' ;;
  'create token '*) printf 'synthetic-token\\n' ;;
esac`,
  );
  mock("kubectl", "exit 0");
  mock("jq", "printf '1\\n'");
  mock("rsync", "printf 'rsync\\n' >> \"$EVENTS\"");
  mock(
    "podman",
    `
printf 'podman %s\\n' "$1" >> "$EVENTS"
  if [[ "$1" == run ]]; then
  [[ "$*" == *type=tmpfs,destination=/tmp/secrets,tmpfs-mode=0700* ]] || exit 99
  cat >/dev/null
  exit "\${CONTAINER_STATUS:-0}"
fi`,
  );
  mock(
    "curl",
    `
printf 'curl\\n' >> "$EVENTS"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -o ]]; then printf 'current-aws-ca' > "$2"; exit 0; fi
  shift
done
printf 'The claimed cluster rhdh-4-20-us-east-2 is ready after 10 seconds\\n'`,
  );
  mock(
    "yarn",
    `
printf 'yarn namespace=%s\\n' "$NAME_SPACE" >> "$EVENTS"
[[ "$(< "$RDS_DB_CERTIFICATES_PATH")" == current-aws-ca ]]
[[ "$(< "$AZURE_DB_CERTIFICATES_PATH")" == azure-ca ]]`,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("host runtime", () => {
  it("rejects a missing namespace before retrieving secrets", () => {
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"], {
      NAME_SPACE: "",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NAME_SPACE is required");
    expect(events()).toBe("");
  });

  it.each(["showcase-rbac", "showcase-operator-rbac", "showcase-*"])(
    "validates RBAC namespaces for %s",
    (project) => {
      const result = run("e2e-tests/local-test.sh", ["--", "--project", project]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("NAME_SPACE_RBAC is required");
      expect(events()).toBe("");
    },
  );

  it("validates every project in Playwright's multi-value option", () => {
    const result = run("e2e-tests/local-test.sh", ["--", "--project", "showcase", "showcase-rbac"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NAME_SPACE_RBAC is required");
    expect(events()).toBe("");
  });

  it.each(["Invalid_Name", "-invalid", "a".repeat(64)])(
    "rejects an invalid namespace: %s",
    (namespace) => {
      const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"], {
        NAME_SPACE: namespace,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Invalid Kubernetes namespace");
      expect(events()).toBe("");
    },
  );

  it("preserves the caller namespace and downloads the current CA", () => {
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(events()).toBe("secrets\ncurl\nyarn namespace=local-showcase\n");
    expect(readdirSync(join(root, "e2e-tests/.local-test"))).toEqual([]);
  });

  it("keeps multiline secrets as data and restores caller connection values", async () => {
    const password = `synthetic-"'\\\n$(touch "$HOME/executed")\n\n`;
    await stream([
      { name: "AUTH_PROVIDERS_DEFAULT_USER_PASSWORD", value: password },
      { name: "AUTH_PROVIDERS_RHBK_CLIENT_SECRET", value: "synthetic-rhbk-secret" },
      { name: "BASE_URL", value: "https://profile.test" },
      { name: "K8S_CLUSTER_TOKEN", value: "profile-token" },
      { name: "NAME_SPACE", value: "profile-namespace" },
      { name: "NODE_OPTIONS", value: "--require=untrusted.js" },
      { name: "EPHEMERAL_CLUSTER_ADMIN_PASSWORD", value: "synthetic-debug-password" },
    ]);
    writeFileSync(join(root, "expected-password"), password);
    mock(
      "yarn",
      `exec node -e '
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      assert.equal(process.env.DEFAULT_USER_PASSWORD, fs.readFileSync(process.env.HOME + "/expected-password", "utf8"));
      assert.equal(process.env.RHBK_CLIENT_SECRET, "synthetic-rhbk-secret");
      assert.equal(process.env.BASE_URL, "https://example.test");
      assert.equal(process.env.K8S_CLUSTER_TOKEN, "caller-token");
      assert.equal(process.env.NAME_SPACE, "local-showcase");
      assert.equal(process.env.NODE_OPTIONS, undefined);
      assert.equal(process.env.EPHEMERAL_CLUSTER_ADMIN_PASSWORD, undefined);
      assert.equal(process.env.BW_SESSION, undefined);
      assert.equal(process.env.RHDH_E2E_SECRET_FD, undefined);
      assert.equal(process.env.REDIS_PASSWORD, "test123");
    '`,
    );
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"], {
      K8S_CLUSTER_TOKEN: "caller-token",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(join(root, "executed"))).toBe(false);
    expect(readdirSync(join(root, "e2e-tests/.local-test"))).toEqual([]);
  });

  it("keeps large certificates file-backed and propagates the test exit code", async () => {
    await stream([
      { name: "azure_db_certificates__dot__pem", value: "azure-ca".repeat(50_000) },
      { name: "rds_db_certificates_pem", value: "stale-rds-ca".repeat(50_000) },
    ]);
    mock(
      "yarn",
      `
[[ -z "\${azure_db_certificates__dot__pem+x}" && -z "\${rds_db_certificates_pem+x}" ]]
[[ $(wc -c < "$AZURE_DB_CERTIFICATES_PATH") -eq 400000 ]]
[[ "$(< "$RDS_DB_CERTIFICATES_PATH")" == current-aws-ca ]]
exit 23`,
    );
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"]);
    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    expect(readdirSync(join(root, "e2e-tests/.local-test"))).toEqual([]);
  });

  it("rejects an invalid stream before downloading certificates or starting tests", () => {
    writeFileSync(join(root, "stream"), "invalid-stream");
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"]);
    expect(result.status).toBe(1);
    expect(events()).toBe("secrets\n");
    expect(result.stderr).toContain("Local test secret preparation");
  });

  it("rejects conflicting certificate names before starting tests", async () => {
    await stream([
      { name: "azure_db_certificates_pem", value: "one-ca" },
      { name: "azure_db_certificates__dot__pem", value: "other-ca" },
    ]);
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"]);
    expect(result.status).toBe(1);
    expect(events()).toBe("secrets\n");
    expect(result.stderr).not.toContain("other-ca");
  });

  it("cleans up certificates after cancellation", async () => {
    mock(
      "yarn",
      `
printf 'yarn started\\n' >> "$EVENTS"
trap 'exit 143' TERM
while true; do sleep 0.05; done`,
    );
    const child = spawn(
      "/bin/bash",
      [join(root, "e2e-tests/local-test.sh"), "--", "--project=showcase"],
      {
        env,
        stdio: "ignore",
      },
    );
    const completed = once(child, "exit");
    try {
      await expect.poll(events, { timeout: 10_000 }).toContain("yarn started");
      expect(readdirSync(join(root, "e2e-tests/.local-test"))).toHaveLength(1);
    } finally {
      child.kill("SIGTERM");
      await completed;
    }
    expect(child.exitCode).toBe(143);
    expect(readdirSync(join(root, "e2e-tests/.local-test"))).toEqual([]);
  }, 15_000);

  it("removes a failed CA download instead of falling back to stored certificates", () => {
    mock("curl", `while [[ "$1" != -o ]]; do shift; done; printf partial > "$2"; exit 22`);
    mock("yarn", `[[ ! -e "$RDS_DB_CERTIFICATES_PATH" && -z "\${rds_db_certificates_pem+x}" ]]`);
    const result = run("e2e-tests/local-test.sh", ["--", "--project=showcase"], {
      rds_db_certificates_pem: "stale-stored-ca",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("RDS TLS tests will not run");
    expect(readdirSync(join(root, "e2e-tests/.local-test"))).toEqual([]);
  });
});

describe("container runner", () => {
  it.each([{ BW_SESSION: "" }, { FAIL_SECRETS: "1" }])(
    "does not mutate the cluster when secret loading fails: %j",
    (overrides) => {
      const result = run("e2e-tests/local-run.sh", runArgs, overrides);
      expect(result.status).not.toBe(0);
      expect(events()).not.toContain("oc ");
      expect(events()).not.toContain("rsync");
      expect(events()).not.toContain("podman run");
      expect(existsSync(join(root, "e2e-tests/.local-test/run.lock"))).toBe(false);
    },
  );

  it("retrieves secrets before provisioning and propagates container failure", () => {
    const result = run("e2e-tests/local-run.sh", runArgs, { CONTAINER_STATUS: "23" });
    expect(result.status).toBe(23);
    expect(events().indexOf("secrets\n")).toBeLessThan(events().indexOf("oc create"));
    expect(events()).toContain("podman run");
    expect(existsSync(join(root, "e2e-tests/.local-test/run.lock"))).toBe(false);
  });

  it("rejects a concurrent invocation without disturbing the active run", async () => {
    mock(
      "podman",
      `
printf 'podman %s\\n' "$1" >> "$EVENTS"
if [[ "$1" == run ]]; then
  while [[ ! -f "$RELEASE" ]]; do sleep 0.05; done
  cat >/dev/null
fi`,
    );
    const first = spawn("/bin/bash", [join(root, "e2e-tests/local-run.sh"), ...runArgs], {
      env,
      stdio: "ignore",
    });
    const completed = once(first, "exit");
    try {
      await expect.poll(events, { timeout: 10_000 }).toContain("podman run");
      const result = run("e2e-tests/local-run.sh", runArgs);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("Concurrent runs are not supported");
      expect(existsSync(join(root, "e2e-tests/.local-test/run.lock"))).toBe(true);
    } finally {
      writeFileSync(join(root, "release"), "");
      first.kill("SIGTERM");
      await completed;
    }
    expect(existsSync(join(root, "e2e-tests/.local-test/run.lock"))).toBe(false);
  }, 15_000);

  it("holds the lock during cancellation until the runner has stopped", async () => {
    mock(
      "podman",
      `
printf 'podman %s\\n' "$1" >> "$EVENTS"
if [[ "$1" == run ]]; then
  trap 'printf "stopping\\n" >> "$EVENTS"; while [[ ! -f "$RELEASE" ]]; do sleep 0.05; done; exit 143' TERM
  while true; do sleep 0.05; done
fi`,
    );
    const first = spawn("/bin/bash", [join(root, "e2e-tests/local-run.sh"), ...runArgs], {
      env,
      stdio: "ignore",
    });
    const completed = once(first, "exit");
    try {
      await expect.poll(events, { timeout: 10_000 }).toContain("podman run");
      first.kill("SIGTERM");
      await expect.poll(events).toContain("stopping");
      const result = run("e2e-tests/local-run.sh", runArgs);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain("Concurrent runs are not supported");
    } finally {
      writeFileSync(join(root, "release"), "");
      first.kill("SIGTERM");
      await completed;
    }
    expect(first.exitCode).toBe(143);
    expect(existsSync(join(root, "e2e-tests/.local-test/run.lock"))).toBe(false);
  }, 15_000);
});

describe("cluster claim login", () => {
  it("rejects an invalid URL before fetching logs or secrets", () => {
    const result = run(".ci/pipelines/ocp-cluster-claim-login.sh", ["https://example.test"]);
    expect(result.status).toBe(2);
    expect(events()).toBe("");
  });

  it.each([
    ["exit 22", "HTTP or network failure"],
    ["printf 'no claim\\n'", "Cluster claim not found"],
    [
      "printf 'The claimed cluster rhdh-4-20-us-east-2-extra is ready after 1s\\n'",
      "Namespace must match",
    ],
  ])("fails before secret loading on invalid lookup: %s", (script, message) => {
    mock("curl", script);
    const result = run(".ci/pipelines/ocp-cluster-claim-login.sh", [prow]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(message);
    expect(events()).toBe("");
  });

  it("rejects ambiguous cluster claims before loading credentials", () => {
    mock(
      "curl",
      `printf '%s\\n' \
      'The claimed cluster rhdh-4-20-us-east-2 is ready after 1s' \
      'The claimed cluster rhdh-4-21-us-east-2 is ready after 1s'`,
    );
    const result = run(".ci/pipelines/ocp-cluster-claim-login.sh", [prow]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("Multiple cluster claims");
    expect(events()).toBe("");
  });

  it("treats clipboard and browser failures as warnings after successful login", () => {
    mock("pbcopy", "cat >/dev/null; exit 1");
    mock("xdg-open", "exit 1");
    mock("sleep", "exit 0");
    const result = run(".ci/pipelines/ocp-cluster-claim-login.sh", [prow, "--open-console"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Unable to copy password");
    expect(result.stderr).toContain("Unable to open browser");
    expect(result.stderr).not.toContain("synthetic-password");
  });

  it.each([prow, `${prow}/`, `${prow}?focus=claim#logs`])(
    "fetches the claim once and succeeds non-interactively: %s",
    (url) => {
      const result = run(".ci/pipelines/ocp-cluster-claim-login.sh", [url]);
      expect(result.status).toBe(0);
      expect(events()).toMatch(/^curl\nsecrets\noc login /u);
      expect(result.stdout + result.stderr).toContain("Web console not opened");
    },
  );
});
