import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const decoder = fileURLToPath(new URL("../decode-secret-stream.mjs", import.meta.url));

function encode(entries: Array<{ name: string; value: string }>): Buffer {
  const sorted = entries.toSorted((left, right) => left.name.localeCompare(right.name));
  const chunks = [Buffer.from("RHDHSEC1"), Buffer.alloc(4)];
  chunks[1].writeUInt32BE(sorted.length);
  for (const entry of sorted) {
    const name = Buffer.from(entry.name);
    const value = Buffer.from(entry.value);
    const frame = Buffer.alloc(8);
    frame.writeUInt32BE(name.length, 0);
    frame.writeUInt32BE(value.length, 4);
    chunks.push(frame, name, value);
  }
  chunks.push(Buffer.from("RHDHEND1"));
  return Buffer.concat(chunks);
}

describe("decode-secret-stream", () => {
  it("writes ordinary and certificate secrets with private permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "rhdh-secret-stream-test-"));
    try {
      execFileSync(process.execPath, [decoder, directory], {
        input: encode([
          { name: "AUTH_TOKEN", value: "line one\nline two" },
          {
            name: "rds_db_certificates_pem",
            value: "-----BEGIN CERTIFICATE-----\nlarge\n",
          },
        ]),
      });

      expect(readFileSync(join(directory, "AUTH_TOKEN"), "utf8")).toBe("line one\nline two");
      expect(readFileSync(join(directory, "rds-db-certificates.pem"), "utf8")).toBe(
        "-----BEGIN CERTIFICATE-----\nlarge\n",
      );
      expect(statSync(join(directory, "AUTH_TOKEN")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed input without creating secret files", () => {
    const directory = mkdtempSync(join(tmpdir(), "rhdh-secret-stream-test-"));
    try {
      expect(() =>
        execFileSync(process.execPath, [decoder, directory], {
          input: Buffer.from("not-a-secret-stream"),
          stdio: ["pipe", "ignore", "ignore"],
        }),
      ).toThrow(/Command failed/u);
      expect(statSync(directory).isDirectory()).toBe(true);
      expect(() => readFileSync(join(directory, "AUTH_TOKEN"), "utf8")).toThrow(/ENOENT/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
