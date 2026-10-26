import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchJson,
  SourceMapLoader,
  sourceMapUrlOf,
} from "../playwright/support/coverage/source-maps";

const MAP = { version: 3, sources: ["webpack://app/./src/App.tsx"], mappings: "AAAA" };
const servers: (http.Server | https.Server)[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.restoreAllMocks();
});

async function listen(server: http.Server | https.Server, scheme: string): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(`unexpected server address: ${String(address)}`);
  }
  return `${scheme}://127.0.0.1:${address.port}`;
}

function bundle(url: string, mapReference = "main.js.map") {
  return { url, source: `console.log(1);\n//# sourceMappingURL=${mapReference}`, functions: [] };
}

describe("sourceMapUrlOf", () => {
  it.each([
    ["a relative reference", "main.js.map", "https://rhdh.test/static/main.js.map"],
    ["an absolute reference", "https://cdn.test/m.map", "https://cdn.test/m.map"],
  ])("resolves %s against the bundle URL", (_, reference, expected) => {
    expect(sourceMapUrlOf(bundle("https://rhdh.test/static/main.js", reference))).toBe(expected);
  });

  it.each([
    ["an inline map, which monocart reads itself", "data:application/json;base64,e30="],
    ["no reference at all", undefined],
  ])("returns nothing for %s", (_, reference) => {
    const entry =
      reference === undefined
        ? { url: "https://rhdh.test/static/main.js", source: "console.log(1);" }
        : bundle("https://rhdh.test/static/main.js", reference);
    expect(sourceMapUrlOf(entry)).toBeUndefined();
  });
});

describe("SourceMapLoader", () => {
  it("attaches each bundle's map and fetches a shared map once", async () => {
    const fetchMap = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(MAP));
    const loader = new SourceMapLoader(fetchMap);

    const first = await loader.attach([bundle("https://rhdh.test/static/main.js")]);
    const second = await loader.attach([bundle("https://rhdh.test/static/main.js")]);

    expect(first).toEqual([{ ...bundle("https://rhdh.test/static/main.js"), sourceMap: MAP }]);
    expect(second[0]?.sourceMap).toBe(MAP);
    expect(fetchMap).toHaveBeenCalledTimes(1);
    expect(loader.failures).toEqual([]);
  });

  it("drops bundles outside /static/ without fetching their maps", async () => {
    const fetchMap = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(MAP));
    const attached = await new SourceMapLoader(fetchMap).attach([
      bundle("https://rhdh.test/api/scalprum/plugin/remoteEntry.js"),
      { not: "an entry" },
    ]);
    expect(attached).toEqual([]);
    expect(fetchMap).not.toHaveBeenCalled();
  });

  it("drops a bundle whose map does not load, and records it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = new SourceMapLoader(() => Promise.reject(new Error("HTTP 404")));

    const attached = await loader.attach([bundle("https://rhdh.test/static/main.js")]);

    expect(attached).toEqual([]);
    expect(loader.failures).toEqual(["https://rhdh.test/static/main.js.map"]);
  });

  it("passes a bundle with an inline map through without fetching", async () => {
    const fetchMap = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(MAP));
    const inline = bundle("https://rhdh.test/static/main.js", "data:application/json;base64,e30=");

    const attached = await new SourceMapLoader(fetchMap).attach([inline]);

    expect(attached).toEqual([inline]);
    expect(fetchMap).not.toHaveBeenCalled();
  });

  it("drops a bundle that names no map", async () => {
    const attached = await new SourceMapLoader(() => Promise.resolve(MAP)).attach([
      { url: "https://rhdh.test/static/main.js", source: "console.log(1);" },
    ]);
    expect(attached).toEqual([]);
  });
});

describe("fetchJson", () => {
  it("parses a JSON body", async () => {
    const base = await listen(
      http.createServer((_request, response) => {
        response.end(JSON.stringify(MAP));
      }),
      "http",
    );
    await expect(fetchJson(`${base}/main.js.map`)).resolves.toEqual(MAP);
  });

  it.each([
    [
      "a non-200 status",
      (response: http.ServerResponse) => {
        response.writeHead(404).end();
      },
      /HTTP 404/u,
    ],
    [
      "a body that is not JSON",
      (response: http.ServerResponse) => {
        response.end("<!doctype html>");
      },
      /JSON/u,
    ],
  ])("rejects %s", async (_, handler, error) => {
    const base = await listen(
      http.createServer((_request, response) => {
        handler(response);
      }),
      "http",
    );
    await expect(fetchJson(`${base}/main.js.map`)).rejects.toThrow(error);
  });

  it("gives up on a server that never answers", async () => {
    const base = await listen(
      http.createServer(() => {}),
      "http",
    );
    await expect(fetchJson(`${base}/main.js.map`, 50)).rejects.toThrow(/Timeout 50ms/u);
  });

  // The reason fetchJson exists: CI routes present certificates Node does not trust.
  it.skipIf(spawnSync("openssl", ["version"]).status !== 0)(
    "accepts a self-signed certificate",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "rhdh-coverage-tls-"));
      try {
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-keyout",
            join(directory, "key.pem"),
            "-out",
            join(directory, "cert.pem"),
          ],
          { stdio: "ignore" },
        );
        const base = await listen(
          https.createServer(
            {
              key: readFileSync(join(directory, "key.pem")),
              cert: readFileSync(join(directory, "cert.pem")),
            },
            (_request, response) => {
              response.end(JSON.stringify(MAP));
            },
          ),
          "https",
        );
        await expect(fetchJson(`${base}/main.js.map`)).resolves.toEqual(MAP);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
