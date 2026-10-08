import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { writeSecretStream } from "@red-hat-developer-hub/e2e-test-utils/secrets";
import { describe, expect, it } from "vitest";

const decoder = fileURLToPath(new URL("../decode-secret-stream.ts", import.meta.url));

async function encode(entries: Array<{ name: string; value: string }>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Uint8Array, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  await writeSecretStream(stream, entries);
  return Buffer.concat(chunks);
}

describe("decode-secret-stream", () => {
  it("writes ordinary and certificate secrets with private permissions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rhdh-secret-stream-test-"));
    try {
      execFileSync(process.execPath, [decoder, directory], {
        input: await encode([
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

  it("normalizes the GSM-encoded Azure certificate name for the original CI path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rhdh-secret-stream-test-"));
    try {
      execFileSync(process.execPath, [decoder, directory], {
        input: await encode([{ name: "azure_db_certificates__dot__pem", value: "azure-ca" }]),
      });
      expect(readFileSync(join(directory, "azure-db-certificates.pem"), "utf8")).toBe("azure-ca");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects conflicting certificate aliases before writing any files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rhdh-secret-stream-test-"));
    try {
      const input = await encode([
        { name: "AUTH_TOKEN", value: "synthetic-token" },
        { name: "azure_db_certificates_pem", value: "one-ca" },
        { name: "azure_db_certificates__dot__pem", value: "another-ca" },
      ]);
      expect(() =>
        execFileSync(process.execPath, [decoder, directory], {
          input,
          stdio: ["pipe", "ignore", "ignore"],
        }),
      ).toThrow(/Command failed/u);
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
