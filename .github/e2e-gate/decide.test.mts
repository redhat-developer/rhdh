import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alreadyRequested,
  changedPaths,
  decide,
  prowStatus,
  runRequestMarker,
  type GateInput,
} from "./decide.mts";

// A trusted member's PR with a freshly published image.
const base: GateInput = {
  files: ["packages/app/src/App.tsx"],
  author: "some-member",
  authorAssociation: "MEMBER",
  orgMember: true,
  title: "feat: something",
  labels: [],
  draft: false,
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
    // cleanup.sh sources these in every job, including OCP Helm.
    ".ci/pipelines/cluster/gke/gcloud.sh",
    ".ci/pipelines/cluster/eks/aws.sh",
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

describe("renamed files", () => {
  it("lists both the old and the new path", () => {
    assert.deepEqual(
      changedPaths([
        { filename: "docs/new.md", previous_filename: "docs/old.md" },
        { filename: "README.md" },
      ]),
      ["docs/new.md", "docs/old.md", "README.md"],
    );
  });

  it("runs when a values file Helm reads is renamed to a skipped name", () => {
    const files = changedPaths([
      {
        filename: ".ci/pipelines/value_files/values_showcase-sanity.yaml",
        previous_filename: ".ci/pipelines/value_files/values_showcase.yaml",
      },
    ]);
    assert.equal(action({ files }), "run");
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
    ".ci/pipelines/cluster/eks/eks-helm-deployment.sh",
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
      action({
        author: "stranger",
        authorAssociation: "CONTRIBUTOR",
        orgMember: false,
      }),
      "wait",
    );
  });

  it("runs for private org members that GitHub reports as CONTRIBUTOR", () => {
    assert.equal(
      action({ authorAssociation: "CONTRIBUTOR", orgMember: true }),
      "run",
    );
  });

  it("runs untrusted contributors once ok-to-test is set", () => {
    assert.equal(
      action({
        authorAssociation: "CONTRIBUTOR",
        orgMember: false,
        labels: ["ok-to-test"],
      }),
      "run",
    );
  });

  it("runs for collaborators", () => {
    assert.equal(
      action({ authorAssociation: "COLLABORATOR", orgMember: false }),
      "run",
    );
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

  it("runs on the next image for the same directories Prow accepts", () => {
    assert.equal(
      action({
        files: ["e2e-tests/playwright/e2e/a.spec.ts", ".claude/skills/x.md"],
        imageSkipped: true,
        publishResult: "skipped",
      }),
      "run",
    );
  });

  it("fails a skipped build for directories Prow does not accept", () => {
    // Prow would wait 60 minutes for a PR image that was never pushed.
    for (const file of ["e2e/foo.ts", "doc/foo.ts"]) {
      assert.equal(
        action({
          files: [file],
          imageSkipped: true,
          publishResult: "skipped",
        }),
        "fail",
        file,
      );
    }
  });

  it("fails a Renovate PR whose image did not build instead of asking for /test", () => {
    assert.equal(
      action({ author: "renovate[bot]", buildConclusion: "failure" }),
      "fail",
    );
  });

  it("fails an untrusted PR whose image was not published instead of asking for /test", () => {
    assert.equal(
      action({
        authorAssociation: "NONE",
        orgMember: false,
        publishResult: "failure",
      }),
      "fail",
    );
  });
});

describe("draft PRs", () => {
  it("waits on drafts instead of claiming a cluster", () => {
    const d = decide({ ...base, draft: true });
    assert.equal(d.action, "wait");
    assert.match(d.reason, /ready for review/);
    assert.match(d.reason, /\/test e2e-ocp-helm/);
  });

  it("still skips drafts that need no cluster", () => {
    assert.equal(action({ draft: true, files: ["docs/index.md"] }), "skip");
  });

  it("still skips rhdh-bot [skip-e2e] drafts", () => {
    assert.equal(
      action({
        draft: true,
        author: "rhdh-bot",
        authorAssociation: "MEMBER",
        title: "chore: bump base image [skip-e2e]",
        files: ["build/containerfiles/Containerfile"],
      }),
      "skip",
    );
  });

  it("still reports image build failures on drafts", () => {
    assert.equal(action({ draft: true, buildConclusion: "failure" }), "fail");
  });
});

describe("existing Prow results", () => {
  const gate = { login: "github-actions[bot]" };
  const prow = { login: "openshift-ci[bot]" };
  const ctx = "ci/prow/e2e-ocp-helm";

  it("keeps a Prow success over a gate pending (manual Renovate run)", () => {
    const s = prowStatus([
      { context: ctx, state: "success", creator: prow },
      { context: ctx, state: "pending", creator: gate },
    ]);
    assert.equal(s?.state, "success");
  });

  it("keeps a Prow failure on a skipped-build PR", () => {
    const s = prowStatus([
      { context: "ci/prow/images", state: "success", creator: prow },
      { context: ctx, state: "failure", creator: prow },
      { context: ctx, state: "failure", creator: gate },
    ]);
    assert.equal(s?.state, "failure");
  });

  it("lets the gate replace its own status", () => {
    assert.equal(
      prowStatus([{ context: ctx, state: "pending", creator: gate }]),
      null,
    );
  });

  it("ignores other contexts and empty lists", () => {
    assert.equal(prowStatus([]), null);
    assert.equal(
      prowStatus([
        { context: "ci/prow/images", state: "success", creator: prow },
      ]),
      null,
    );
  });
});

describe("earlier run requests", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const body = `/test e2e-ocp-helm\n${runRequestMarker(sha)}\nThe PR image ...`;

  it("finds the bot's own request", () => {
    assert.equal(
      alreadyRequested([{ body, user: { login: "rhdh-bot" } }], sha),
      true,
    );
  });

  it("ignores a spoofed marker from anyone else", () => {
    assert.equal(
      alreadyRequested([{ body, user: { login: "pr-author" } }], sha),
      false,
    );
    assert.equal(
      alreadyRequested(
        [{ body: runRequestMarker(sha), user: { login: "pr-author" } }],
        sha,
      ),
      false,
    );
  });

  it("ignores bot comments without the command or for another commit", () => {
    assert.equal(
      alreadyRequested(
        [
          {
            body: `hello ${runRequestMarker(sha)}`,
            user: { login: "rhdh-bot" },
          },
        ],
        sha,
      ),
      false,
    );
    assert.equal(
      alreadyRequested([{ body, user: { login: "rhdh-bot" } }], "f".repeat(40)),
      false,
    );
  });
});
