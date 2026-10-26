import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// RHIDP-13242: testing::_upload_e2e_coverage must attribute the upload to the PR
// head commit, and only when the run tested that PR's own image. Presubmits test a
// local merge of the PR onto its base, so the checkout's HEAD is a commit GitHub has
// never seen.
const repository = fileURLToPath(new URL("../../", import.meta.url));
const PR_HEAD = "0123456789abcdef0123456789abcdef01234567";
// What the Prow step sets when it deploys the image built from this PR.
const PR_IMAGE_TAG = `pr-4321-${PR_HEAD.slice(0, 8)}`;
const PR_RUN = { PULL_PULL_SHA: PR_HEAD, PULL_NUMBER: "4321", TAG_NAME: PR_IMAGE_TAG };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rhdh-e2e-coverage-upload-"));
  // Records its argv and the token it can see instead of talking to Codecov.
  writeFileSync(
    join(root, "codecov"),
    `#!/bin/bash\nprintf '%s\\n' "$@" > "${root}/argv"\nprintf '%s' "\${CODECOV_TOKEN:-}" > "${root}/token"\n`,
  );
  chmodSync(join(root, "codecov"), 0o755);
  writeFileSync(join(root, "lcov.info"), "SF:packages/app/src/App.tsx\nDA:1,1\nend_of_record\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Sources testing.sh and runs the upload for `namespace`. `prelude` runs first, so a
 * test can replace commands such as curl with shell functions; executables in
 * `$ROOT/bin` come first on PATH.
 */
function upload(env: Record<string, string>, prelude = "", namespace = "") {
  const result = spawnSync(
    "/bin/bash",
    [
      "--noprofile",
      "--norc",
      "-euc",
      `${prelude}\nsource "$DIR/lib/testing.sh"; testing::_upload_e2e_coverage "$ROOT/lcov.info" "$NAMESPACE"`,
    ],
    {
      env: {
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        NAMESPACE: namespace,
        HOME: root,
        ROOT: root,
        DIR: join(repository, ".ci/pipelines"),
        ARTIFACT_DIR: root,
        SHARED_DIR: root,
        CODECOV_BIN: join(root, "codecov"),
        ...env,
      },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  const argvFile = join(root, "argv");
  // Empty when the CLI was never invoked.
  const argv = existsSync(argvFile) ? readFileSync(argvFile, "utf8").trim().split("\n") : [];
  return { ...result, argv, output: result.stdout + result.stderr };
}

describe("testing::_upload_e2e_coverage", () => {
  it("uploads to the PR head commit Prow reports, not the merge commit", () => {
    const { status, argv } = upload({ CODECOV_TOKEN: "token", ...PR_RUN });
    expect(status).toBe(0);
    expect(argv).toEqual([
      "upload-process",
      "--disable-search",
      "--file",
      join(root, "lcov.info"),
      // Codecov keeps only report paths present in this tree's `git ls-files`.
      "--network-root-folder",
      repository.replace(/\/$/u, ""),
      "--flag",
      "rhdh-e2e-frontend",
      "--slug",
      "redhat-developer/rhdh",
      "--sha",
      PR_HEAD,
      "--pr",
      "4321",
      "--fail-on-error",
    ]);
  });

  it("hands the token to the CLI through the environment, never its arguments", () => {
    const { argv } = upload({ CODECOV_TOKEN: "s3cr3t-token", ...PR_RUN });
    expect(argv).toContain("upload-process");
    expect(argv.join(" ")).not.toContain("s3cr3t-token");
    expect(readFileSync(join(root, "token"), "utf8")).toBe("s3cr3t-token");
  });

  it("skips the upload when the report names no source file", () => {
    writeFileSync(join(root, "lcov.info"), "TN:\n");
    const { status, argv, output } = upload({ CODECOV_TOKEN: "token", ...PR_RUN });
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain("names no source file");
  });

  it("accepts a tag whose sha prefix git lengthened past 8 characters", () => {
    const { argv } = upload({
      CODECOV_TOKEN: "token",
      ...PR_RUN,
      TAG_NAME: `pr-4321-${PR_HEAD.slice(0, 11)}`,
    });
    expect(argv).toContain(PR_HEAD);
  });

  it.each([
    ["a CI-only PR that deployed `next`", { ...PR_RUN, TAG_NAME: "next" }],
    ["a tag built from another commit", { ...PR_RUN, TAG_NAME: "pr-4321-ffffffff" }],
    ["a tag for another PR", { ...PR_RUN, TAG_NAME: `pr-1-${PR_HEAD.slice(0, 8)}` }],
    ["a tag too short to identify a commit", { ...PR_RUN, TAG_NAME: "pr-4321-0123" }],
    // Rehearsals: PULL_* describe the openshift/release PR, while the tag (when the step
    // builds one at all) names an rhdh PR.
    [
      "a rehearsal",
      { PULL_PULL_SHA: "a".repeat(40), PULL_NUMBER: "70001", TAG_NAME: PR_IMAGE_TAG },
    ],
    ["no PR at all (periodic)", { TAG_NAME: "next" }],
    // Each malformed value comes with a tag that would otherwise match it, so only
    // the format check can reject it.
    [
      "a malformed sha",
      { PULL_PULL_SHA: "not-a-hex-sha", PULL_NUMBER: "4321", TAG_NAME: "pr-4321-not-a-hex" },
    ],
    [
      "a non-numeric PR",
      { ...PR_RUN, PULL_NUMBER: "abc", TAG_NAME: `pr-abc-${PR_HEAD.slice(0, 8)}` },
    ],
  ])("skips the upload, without failing, for %s", (_, env) => {
    const { status, argv, output } = upload({ CODECOV_TOKEN: "token", ...env });
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain("did not test a PR image");
  });

  it("skips the upload when no token is mounted", () => {
    const { status, argv, output } = upload({ ...PR_RUN });
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain("No Codecov token mounted");
  });

  it("skips the upload when the repository root cannot be resolved", () => {
    const { status, argv, output } = upload(
      { CODECOV_TOKEN: "token", ...PR_RUN },
      "git() { return 128; }",
    );
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain("Could not resolve the repository root");
  });

  it("does not fail the job when the upload itself fails", () => {
    writeFileSync(join(root, "codecov"), "#!/bin/bash\nexit 1\n");
    const { status, output } = upload({ CODECOV_TOKEN: "token", ...PR_RUN });
    expect(status).toBe(0);
    expect(output).toContain("upload failed (non-fatal)");
  });
});

// A curl that records its arguments and prints a GitHub compare response.
const githubSays = (status: string) =>
  `curl() { printf '%s\\n' "$@" > "$ROOT/curl-args"; echo '{"status":"${status}"}'; }`;

// The main OCP Helm nightly uploads to the main commit its `next` image was built
// from, named by the image's revision label, not to the checkout's HEAD.
describe("testing::_upload_e2e_coverage from the main nightly", () => {
  const MAIN_JOB = "periodic-ci-redhat-developer-rhdh-main-e2e-ocp-helm-nightly";
  const DIGEST = `quay.io/rhdh-community/rhdh@sha256:${"d".repeat(64)}`;
  const MAIN_RUN = { CODECOV_TOKEN: "token", JOB_NAME: MAIN_JOB, TAG_NAME: "next" };
  // A commit this checkout has and HEAD contains. HEAD itself, because CI checks
  // out with fetch-depth 1 and has no parent commit.
  const onMain = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  // A well-formed commit this checkout does not have, so GitHub is asked.
  const unknown = "e".repeat(40);

  /**
   * Puts fake `oc` and `skopeo` executables in `$ROOT/bin` (they run under
   * `timeout`, so shell functions cannot replace them). `pods` is what
   * `oc get pods` prints: one "<image> <imageID>" line per container.
   */
  function mainUpload(
    revision: string | null,
    {
      pods = `quay.io/rhdh-community/rhdh:next ${DIGEST}\nregistry.redhat.io/postgresql:16 x@sha256:1`,
      env = {},
      prelude = "",
      namespace = "showcase-ci-nightly",
    }: { pods?: string; env?: Record<string, string>; prelude?: string; namespace?: string } = {},
  ) {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "oc"), `#!/bin/bash\nprintf '%b\\n' ${JSON.stringify(pods)}\n`);
    const labels = revision === null ? {} : { "org.opencontainers.image.revision": revision };
    writeFileSync(
      join(bin, "skopeo"),
      `#!/bin/bash\nprintf '%s\\n' "$@" > "${root}/skopeo-args"\ncat <<'JSON'\n${JSON.stringify({ Labels: labels })}\nJSON\n`,
    );
    chmodSync(join(bin, "oc"), 0o755);
    chmodSync(join(bin, "skopeo"), 0o755);
    return upload({ ...MAIN_RUN, ...env }, prelude, namespace);
  }

  it("uploads to the image's revision on main, with --branch and no --pr", () => {
    const { status, argv } = mainUpload(onMain);
    expect(status).toBe(0);
    expect(argv.slice(-6)).toEqual([
      "redhat-developer/rhdh",
      "--sha",
      onMain,
      "--branch",
      "main",
      "--fail-on-error",
    ]);
    expect(argv).not.toContain("--pr");
    // The digest the pods ran, not the moving `next` tag.
    expect(readFileSync(join(root, "skopeo-args"), "utf8")).toContain(`docker://${DIGEST}\n`);
  });

  it.each(["ahead", "identical"])(
    "asks GitHub when the checkout lacks the commit, and uploads when main is %s",
    (state) => {
      const { argv } = mainUpload(unknown, { prelude: githubSays(state) });
      expect(argv).toContain(unknown);
      expect(readFileSync(join(root, "curl-args"), "utf8")).toContain(
        `https://api.github.com/repos/redhat-developer/rhdh/compare/${unknown}...main\n`,
      );
    },
  );

  it.each([
    ["another nightly", { env: { JOB_NAME: MAIN_JOB.replace("-ocp-", "-ocp-v4-20-") } }, ""],
    [
      "a release branch nightly",
      { env: { JOB_NAME: MAIN_JOB.replace("main", "release-2.1") } },
      "",
    ],
    ["a tag other than next", { env: { TAG_NAME: "2.1-122" } }, ""],
    ["no namespace", { namespace: "" }, ""],
    ["no RHDH pod", { pods: "registry.redhat.io/postgresql:16 x@sha256:1" }, "found: none"],
    [
      "pods on two digests",
      {
        pods: `quay.io/rhdh-community/rhdh:next ${DIGEST}\nquay.io/rhdh-community/rhdh:next ${DIGEST.replace(/d+$/u, "f".repeat(64))}`,
      },
      "Expected one",
    ],
  ])("skips the upload, without failing, for %s", (_, options, message) => {
    const { status, argv, output } = mainUpload(onMain, options);
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain(message || "did not test a PR image or a main build");
  });

  it.each([
    ["the image has no revision label", null, "", "Could not read a commit revision label"],
    ["the label is not a commit sha", "v2.1.0", "", "Could not read a commit revision label"],
    [
      "main does not contain the commit",
      unknown,
      githubSays("diverged"),
      "Could not confirm that main contains",
    ],
    [
      "GitHub cannot be reached",
      unknown,
      "curl() { return 7; }",
      "Could not confirm that main contains",
    ],
  ])("skips the upload, without failing, when %s", (_, revision, prelude, message) => {
    const { status, argv, output } = mainUpload(revision, { prelude });
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain(message);
  });

  it("reads the commit from pods that run the image by digest", () => {
    const { argv } = mainUpload(onMain, { pods: `${DIGEST} ${DIGEST}` });
    expect(argv).toContain(onMain);
    expect(readFileSync(join(root, "skopeo-args"), "utf8")).toContain(`docker://${DIGEST}\n`);
  });

  // `next` is rebuilt on every merge, so projects deployed later can run a newer image.
  it("uploads again for the commit this job already uploaded", () => {
    const { argv } = mainUpload(onMain, { env: { COVERAGE_MAIN_SHA: onMain } });
    expect(argv).toContain(onMain);
  });

  it("skips a newer commit than the one this job already uploaded", () => {
    const { status, argv, output } = mainUpload(onMain, { env: { COVERAGE_MAIN_SHA: unknown } });
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain(`uploads E2E coverage for ${unknown}; skipping ${onMain}`);
  });

  it("keeps attributing PR runs to the PR head", () => {
    const { argv } = mainUpload(onMain, { env: PR_RUN });
    expect(argv).toContain("--pr");
    expect(argv).toContain(PR_HEAD);
    expect(existsSync(join(root, "skopeo-args"))).toBe(false);
  });
});

// A curl that records its arguments, writes CONTENT to its -o target, then exits
// with STATUS.
const fakeCurl = (content: string, status = 0) =>
  `curl() { printf '%s\\n' "$@" > "$ROOT/curl-args"; while [[ $# -gt 0 ]]; do if [[ $1 == -o ]]; then ${content} > "$2"; shift; fi; shift; done; return ${status}; }`;
const fakeArch = (arch: string) => `uname() { echo "${arch}"; }`;
const RELEASE_DOWNLOAD_URL = "https://github.com/codecov/codecov-cli/releases/download/v11.3.1";

describe("testing::_codecov_cli download", () => {
  // A fresh directory, so the CLI is not already there and has to be fetched.
  function downloadTarget() {
    const directory = join(root, "download");
    mkdirSync(directory);
    return join(directory, "codecov");
  }

  it("downloads, verifies and uses the CLI when none is there yet", () => {
    const target = downloadTarget();
    // The real sha256sum prints "OK" on stdout, which must not end up in the CLI path
    // the upload captures.
    const prelude = `${fakeArch("x86_64")}\n${fakeCurl('cat "$ROOT/codecov"')}\nsha256sum() { echo "codecov: OK"; }`;
    const { status, argv } = upload(
      { CODECOV_TOKEN: "token", ...PR_RUN, CODECOV_BIN: target },
      prelude,
    );
    expect(status).toBe(0);
    expect(argv[0]).toBe("upload-process");
  });

  // Prow schedules steps on both x86_64 and aarch64 nodes; an x86_64 binary on an
  // aarch64 node fails with "Exec format error".
  it.each([
    [
      "x86_64",
      "codecovcli_linux",
      "ca1d64196d2d34771084afe76ea657d581bf628e31d993ff8e52ea09cc88a56d",
    ],
    [
      "aarch64",
      "codecovcli_linux_arm64",
      "baff0923257c20b8594154c9651e7a6848f9783dc4392c6ce71791fec11a5913",
    ],
  ])("fetches the %s build and checks it against its pinned digest", (arch, asset, digest) => {
    const target = downloadTarget();
    const prelude = `${fakeArch(arch)}\n${fakeCurl("printf binary")}\nsha256sum() { cat > "$ROOT/checked"; }`;
    upload({ CODECOV_TOKEN: "token", ...PR_RUN, CODECOV_BIN: target }, prelude);
    const curlArgs = readFileSync(join(root, "curl-args"), "utf8");
    expect(curlArgs).toContain(`${RELEASE_DOWNLOAD_URL}/${asset}\n`);
    // GitHub always redirects release downloads, so -L is required; HTTPS stays enforced
    // across the redirect.
    expect(curlArgs).toMatch(/^-fsSL$/mu);
    expect(curlArgs).toContain("--proto\n=https\n--proto-redir\n=https\n");
    expect(readFileSync(join(root, "checked"), "utf8")).toBe(`${digest}  ${target}\n`);
  });

  it("uses an executable already at CODECOV_BIN on any architecture, without downloading", () => {
    const { status, argv } = upload(
      { CODECOV_TOKEN: "token", ...PR_RUN },
      `${fakeArch("s390x")}\n${fakeCurl("printf binary")}`,
    );
    expect(status).toBe(0);
    expect(argv[0]).toBe("upload-process");
    expect(existsSync(join(root, "curl-args"))).toBe(false);
  });

  // `uname -m` says arm64 only on macOS, where a Linux build cannot run either.
  it.each(["s390x", "arm64"])("skips the upload, without downloading, on %s", (arch) => {
    const target = downloadTarget();
    const { status, argv, output } = upload(
      { CODECOV_TOKEN: "token", ...PR_RUN, CODECOV_BIN: target },
      `${fakeArch(arch)}\n${fakeCurl("printf binary")}`,
    );
    expect(status).toBe(0);
    expect(argv).toEqual([]);
    expect(output).toContain(`No Codecov CLI build for architecture ${arch}`);
    expect(existsSync(join(root, "curl-args"))).toBe(false);
  });

  // The digest is pinned, so only a mismatch can be checked against the real tool; a
  // malformed check line would fail with a format error instead. GNU only, as in CI:
  // BSD sha256sum has no --strict.
  it.skipIf(!spawnSync("sha256sum", ["--version"], { encoding: "utf8" }).stdout?.includes("GNU"))(
    "feeds the real sha256sum a well-formed check line",
    () => {
      const target = downloadTarget();
      const { output } = upload(
        { CODECOV_TOKEN: "token", ...PR_RUN, CODECOV_BIN: target },
        `${fakeArch("x86_64")}\n${fakeCurl("printf fake")}`,
      );
      expect(output).toContain(`${target}: FAILED`);
      expect(output).not.toContain("no properly formatted");
      expect(existsSync(target)).toBe(false);
    },
  );

  it.each([
    // Writes part of the file before failing, as an interrupted transfer would.
    ["the download fails", fakeCurl("printf partial", 22)],
    ["the checksum does not match", `${fakeCurl("printf fake")}\nsha256sum() { return 1; }`],
  ])("skips the upload, leaves nothing behind, when %s", (_, prelude) => {
    const target = downloadTarget();
    const { status, output } = upload(
      { CODECOV_TOKEN: "token", ...PR_RUN, CODECOV_BIN: target },
      `${fakeArch("x86_64")}\n${prelude}`,
    );
    expect(status).toBe(0);
    expect(output).toContain("No checksum-verified Codecov CLI available");
    expect(existsSync(target)).toBe(false);
  });
});
