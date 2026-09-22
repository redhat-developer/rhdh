import { spawnSync } from "child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

const HARNESS = join(__dirname, "..", "local-harness");
const SCRIPT_NAME = "resolve-catalog-index-image.sh";
const LOCK_NAME = "catalog-index.lock";
const DIGEST = `sha256:${"a".repeat(64)}`;

const dirs: string[] = [];

/**
 * The script reads the lock next to itself, so a case with its own lock needs a
 * copy of the script too. `lock: null` leaves the lock out entirely.
 */
function scriptWith(lock: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "resolve-catalog-index-"));
  dirs.push(dir);
  copyFileSync(join(HARNESS, SCRIPT_NAME), join(dir, SCRIPT_NAME));
  if (lock !== null) {
    writeFileSync(join(dir, LOCK_NAME), lock);
  }
  return join(dir, SCRIPT_NAME);
}

function run(script: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

const pinned = (tag: string, digest = DIGEST) =>
  `# comment\nquay.io/rhdh/plugin-catalog-index:${tag}@${digest}\n`;

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("resolve-catalog-index-image.sh", () => {
  const script = () => join(HARNESS, SCRIPT_NAME);

  describe("floating tag", () => {
    it("resolves next for main", () => {
      expect(run(script(), ["main", ""]).stdout).toBe("quay.io/rhdh/plugin-catalog-index:next");
    });

    it("resolves the version tag for a release branch", () => {
      expect(run(script(), ["release-1.10", ""]).stdout).toBe(
        "quay.io/rhdh/plugin-catalog-index:1.10",
      );
    });

    it("treats an empty mode as unpinned", () => {
      expect(run(script(), ["main", "", ""]).stdout).toBe("quay.io/rhdh/plugin-catalog-index:next");
    });
  });

  describe("override", () => {
    it("wins over the pin", () => {
      const s = scriptWith(pinned("next"));
      expect(run(s, ["main", "quay.io/rhdh/plugin-catalog-index:1.9", "--pinned"]).stdout).toBe(
        "quay.io/rhdh/plugin-catalog-index:1.9",
      );
    });

    it("rejects a value that could forge a multi-line GITHUB_OUTPUT", () => {
      const result = run(script(), ["main", "evil\nimage=pwned"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("invalid catalog_index_image");
    });
  });

  describe("--pinned", () => {
    it("emits the digest-only form, which is the one skopeo accepts", () => {
      const s = scriptWith(pinned("next"));
      // A reference carrying both a tag and a digest fails with
      // "Docker references with both a tag and digest are currently not supported".
      expect(run(s, ["main", "", "--pinned"]).stdout).toBe(
        `quay.io/rhdh/plugin-catalog-index@${DIGEST}`,
      );
    });

    it("fails when the pinned tag does not match the branch", () => {
      const s = scriptWith(pinned("next"));
      const result = run(s, ["release-1.10", "", "--pinned"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("but branch 'release-1.10' resolves to");
    });

    it("fails when the lock is missing", () => {
      const result = run(scriptWith(null), ["main", "", "--pinned"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("catalog index lock not found");
    });

    it("fails when the lock has no pin", () => {
      const result = run(scriptWith("# only a comment\n"), ["main", "", "--pinned"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("expected exactly one uncommented line");
    });

    it("fails when the lock has more than one pin, rather than taking the first", () => {
      const lock =
        pinned("next") + `quay.io/rhdh/plugin-catalog-index:next@sha256:${"b".repeat(64)}\n`;
      const result = run(scriptWith(lock), ["main", "", "--pinned"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("expected exactly one uncommented line");
    });

    it("fails when the pin is not an image reference", () => {
      const result = run(scriptWith("# c\nnot-an-image-ref\n"), ["main", "", "--pinned"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("invalid pin");
    });

    it("tolerates CRLF and trailing space, which are invisible in an error message", () => {
      const s = scriptWith(`# c\r\nquay.io/rhdh/plugin-catalog-index:next@${DIGEST}  \r\n`);
      expect(run(s, ["main", "", "--pinned"]).stdout).toBe(
        `quay.io/rhdh/plugin-catalog-index@${DIGEST}`,
      );
    });
  });

  it("rejects an unknown mode", () => {
    const result = run(script(), ["main", "", "--bogus"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown argument: --bogus");
  });
});
