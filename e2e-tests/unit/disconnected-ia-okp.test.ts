import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const pipelines = fileURLToPath(new URL("../../.ci/pipelines", import.meta.url));
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rhdh-disconnected-ia-okp-"));
  mkdirSync(join(root, "artifacts"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("disconnected registry authentication", () => {
  it("merges the CI registry.redhat.io credential into private runtime auth", () => {
    const mirrorAuth = join(root, "mirror-auth.json");
    writeFileSync(mirrorAuth, JSON.stringify({ auths: { "mirror.test": { auth: "bWlycm9y" } } }));
    const redHatAuth = Buffer.from(
      JSON.stringify({ auths: { "registry.redhat.io": { auth: "cmVkaGF0" } } }),
    ).toString("base64");
    const script = [
      'source "$PIPELINES/lib/log.sh"',
      'source "$PIPELINES/lib/disconnected/env.sh"',
      "disconnected::setup_auth > /dev/null",
      'jq -c . "$REGISTRY_AUTH_FILE"',
      "if declare -p REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON > /dev/null 2>&1; then printf '\\nset'; else printf '\\nunset'; fi",
    ].join("\n");

    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-ec", script], {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        PIPELINES: pipelines,
        MIRROR_REGISTRY_PULL_SECRET: mirrorAuth,
        REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON: redHatAuth,
      },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    const outputLines = result.stdout.trim().split("\n").filter(Boolean);
    const json = outputLines[0];
    const credentialState = outputLines.at(-1);
    expect(JSON.parse(json)).toEqual({
      auths: {
        "mirror.test": { auth: "bWlycm9y" },
        "registry.redhat.io": { auth: "cmVkaGF0" },
      },
    });
    expect(credentialState).toBe("unset");
    expect(readFileSync(mirrorAuth, "utf8")).toBe(
      JSON.stringify({ auths: { "mirror.test": { auth: "bWlycm9y" } } }),
    );
  });
});

describe("disconnected OKP image mirroring", () => {
  it("adds the exact OKP image to the oc-mirror configuration", () => {
    const config = join(root, "imageset-config.yaml");
    const chart = join(root, "chart.tgz");
    writeFileSync(chart, "synthetic chart");
    const script = [
      'source "$PIPELINES/lib/log.sh"',
      'source "$PIPELINES/lib/disconnected/mirror.sh"',
      'disconnected::build_imageset_config "$CONFIG" > /dev/null',
    ].join("\n");

    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-ec", script], {
      env: {
        PATH: process.env.PATH,
        PIPELINES: pipelines,
        CONFIG: config,
        ARTIFACT_DIR: join(root, "artifacts"),
        CHART_LOCAL_TGZ: chart,
        IMAGE_REGISTRY: "registry.redhat.io",
        IMAGE_REPO: "rhdh/rhdh-hub-rhel9",
        TAG_NAME: "next",
        PG_REGISTRY: "registry.redhat.io",
        PG_REPO: "rhel10/postgresql-18",
        PG_SEPARATOR: ":",
        PG_TAG: "latest",
        OKP_IMAGE:
          "registry.redhat.io/offline-knowledge-portal/rhokp-rhel9@sha256:0123456789abcdef",
      },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(config, "utf8")).toContain(
      "- name: registry.redhat.io/offline-knowledge-portal/rhokp-rhel9@sha256:0123456789abcdef",
    );
  });

  it("extends the oc-mirror image timeout when OKP is included", () => {
    const workspace = join(root, "oc-mirror-workspace");
    const argsFile = join(root, "oc-mirror-args.txt");
    const script = [
      'source "$PIPELINES/lib/log.sh"',
      'source "$PIPELINES/lib/disconnected/env.sh"',
      'source "$PIPELINES/lib/disconnected/mirror.sh"',
      "disconnected::_hook_run_oc_mirror() {",
      '  printf "%s\\n" "$@" > "$ARGS_FILE"',
      '  mkdir -p "$WORKSPACE/working-dir/cluster-resources"',
      '  printf "apiVersion: config.openshift.io/v1\\nkind: ImageDigestMirrorSet\\nspec:\\n  imageDigestMirrors: []\\n" > "$WORKSPACE/working-dir/cluster-resources/idms-oc-mirror.yaml"',
      "}",
      'disconnected::run_oc_mirror "$CONFIG" "$WORKSPACE" > /dev/null',
    ].join("\n");

    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-ec", script], {
      env: {
        PATH: process.env.PATH,
        PIPELINES: pipelines,
        CONFIG: join(root, "imageset-config.yaml"),
        WORKSPACE: workspace,
        ARGS_FILE: argsFile,
        ARTIFACT_DIR: join(root, "artifacts"),
        MIRROR_REGISTRY_URL: "mirror.test",
        OKP_IMAGE:
          "registry.redhat.io/offline-knowledge-portal/rhokp-rhel9@sha256:0123456789abcdef",
      },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.status).toBe(0);
    const args = readFileSync(argsFile, "utf8").trim().split("\n");
    expect(args).toContain("--image-timeout");
    expect(args).toContain("30m");
  });
});
