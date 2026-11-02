import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, type GateInput } from "./decide.mts";

// A trusted member's PR with a freshly published image.
const base: GateInput = {
  files: ["packages/app/src/App.tsx"],
  author: "some-member",
  authorAssociation: "MEMBER",
  title: "feat: something",
  labels: [],
  buildConclusion: "success",
  publishResult: "success",
  imageSkipped: false,
};

const action = (over: Partial<GateInput>) =>
  decide({ ...base, ...over }).action;

describe("paths that need a cluster", () => {
  for (const file of [
    "packages/app/src/App.tsx",
    "yarn.lock",
    "package.json",
    "dynamic-plugins/package.json",
    "build/containerfiles/Containerfile",
    "app-config.dynamic-plugins.yaml",
    ".ci/pipelines/jobs/ocp-pull.sh",
    ".ci/pipelines/lib/helm.sh",
    ".ci/pipelines/value_files/values_showcase.yaml",
    ".ci/pipelines/value_files/values_showcase-rbac.yaml",
    "e2e-tests/playwright/e2e/settings.spec.ts",
    "e2e-tests/playwright/utils/common.ts",
    "e2e-tests/package.json",
  ]) {
    it(`runs for ${file}`, () =>
      assert.equal(action({ files: [file] }), "run"));
  }

  it("runs when docs are mixed with code", () => {
    assert.equal(
      action({ files: ["docs/index.md", "packages/app/src/App.tsx"] }),
      "run",
    );
  });
});

describe("paths that do not need a cluster", () => {
  for (const file of [
    "docs/e2e-tests/local-e2e-harness.md",
    "README.md",
    "CONTRIBUTING.md",
    "e2e-tests/README.md",
    ".github/workflows/pr.yaml",
    "OWNERS",
    "e2e-tests/OWNERS",
    ".pr_agent.toml",
    "renovate.json",
    "rpms.lock.yaml",
    ".claude/skills/foo/SKILL.md",
    ".cursor/rules/x.mdc",
    ".rulesync/rules/y.md",
    "e2e-tests/local-harness/resolve-catalog-index-image.sh",
    "e2e-tests/unit/resolve-catalog-index-image.test.ts",
    "e2e-tests/local-run.sh",
    "e2e-tests/playwright.plugin-sanity.config.ts",
    ".ci/pipelines/jobs/ocp-disconnected-helm.sh",
    ".ci/pipelines/jobs/aks-helm.sh",
    ".ci/pipelines/jobs/ocp-nightly.sh",
    ".ci/pipelines/lib/disconnected/mirror.sh",
    ".ci/pipelines/install-methods/operator.sh",
    ".ci/pipelines/cluster/osd-gcp/create-osd.sh",
    ".ci/pipelines/resources/disconnected/policy.json",
    ".ci/pipelines/value_files/diff-values_showcase_AKS.yaml",
    ".ci/pipelines/value_files/diff-values_showcase-sanity-plugins.yaml",
  ]) {
    it(`skips for ${file}`, () =>
      assert.equal(action({ files: [file] }), "skip"));
  }

  it("names every category in the reason", () => {
    const { reason } = decide({
      ...base,
      files: ["docs/a.md", ".ci/pipelines/jobs/aks-helm.sh"],
    });
    assert.equal(
      reason,
      "No cluster needed: only CI for other platforms, docs changed",
    );
  });

  it("does not skip an empty file list", () => {
    assert.equal(action({ files: [] }), "run");
  });
});

describe("authors", () => {
  it("skips rhdh-bot [skip-e2e] base image bumps", () => {
    assert.equal(
      action({
        author: "rhdh-bot",
        title:
          "chore: update main to ubi10/nodejs-24:10.2-1 from ubi10/nodejs-24:10.2-0 [skip-build] [skip-e2e]",
        files: ["build/containerfiles/Containerfile"],
        imageSkipped: true,
      }),
      "skip",
    );
  });

  it("runs rhdh-bot PRs without [skip-e2e]", () => {
    assert.equal(
      action({
        author: "rhdh-bot",
        title: "chore: tagRelease.sh: bump to 1.9.10",
      }),
      "run",
    );
  });

  it("ignores [skip-e2e] from other authors", () => {
    assert.equal(action({ title: "fix: thing [skip-e2e]" }), "run");
  });

  it("waits for a manual /test on Renovate PRs, even with ok-to-test", () => {
    const d = decide({
      ...base,
      author: "renovate[bot]",
      authorAssociation: "NONE",
      labels: ["ok-to-test"],
    });
    assert.equal(d.action, "wait");
    assert.match(d.reason, /\/test e2e-ocp-helm/);
  });

  it("still skips Renovate PRs that only touch tooling", () => {
    assert.equal(
      action({ author: "renovate[bot]", files: [".github/workflows/pr.yaml"] }),
      "skip",
    );
  });

  it("waits for /ok-to-test on untrusted contributors", () => {
    assert.equal(
      action({ author: "stranger", authorAssociation: "CONTRIBUTOR" }),
      "wait",
    );
  });

  it("runs untrusted contributors once ok-to-test is set", () => {
    assert.equal(
      action({ authorAssociation: "CONTRIBUTOR", labels: ["ok-to-test"] }),
      "run",
    );
  });

  it("runs for collaborators", () => {
    assert.equal(action({ authorAssociation: "COLLABORATOR" }), "run");
  });
});

describe("image state", () => {
  it("fails when the image build failed", () => {
    assert.equal(action({ buildConclusion: "failure" }), "fail");
  });

  it("fails when the image could not be published", () => {
    assert.equal(action({ publishResult: "failure" }), "fail");
  });

  it("runs on the next image when only e2e or CI files changed and the build was skipped", () => {
    assert.equal(
      action({
        files: [
          "e2e-tests/playwright/e2e/settings.spec.ts",
          ".ci/pipelines/lib/helm.sh",
        ],
        imageSkipped: true,
        publishResult: "skipped",
      }),
      "run",
    );
  });

  it("fails when [skip-build] skipped the image for a product change", () => {
    assert.equal(
      action({ imageSkipped: true, publishResult: "success" }),
      "fail",
    );
  });
});
