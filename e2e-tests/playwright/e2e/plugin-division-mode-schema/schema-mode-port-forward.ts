/**
 * Start oc port-forward for schema-mode E2E when CI exports forward metadata.
 * Mirrors verify-redis-cache.spec.ts (spawn + wait for tunnel).
 * If SCHEMA_MODE_DB_HOST is set and forward metadata is absent, no process is spawned.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as net from "net";

export interface SchemaModePortForwardHandle {
  stop: () => void;
}

function waitForLocalPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for localhost:${port}`));
        return;
      }
      const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 300);
      });
    };
    tryConnect();
  });
}

/**
 * If SCHEMA_MODE_PORT_FORWARD_NAMESPACE and SCHEMA_MODE_PORT_FORWARD_RESOURCE are set,
 * spawns oc port-forward and sets SCHEMA_MODE_DB_HOST=localhost.
 * If only SCHEMA_MODE_DB_HOST is set (no forward metadata), returns a no-op stop.
 */
export async function ensureSchemaModePortForward(): Promise<SchemaModePortForwardHandle> {
  const ns = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;
  const resource = process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE;
  const localPort = 5432;

  const hasMeta = Boolean(ns && resource);
  const hasHostOnly = Boolean(process.env.SCHEMA_MODE_DB_HOST) && !hasMeta;

  if (!hasMeta) {
    if (hasHostOnly) {
      return { stop: () => {} };
    }
    throw new Error(
      "Set SCHEMA_MODE_PORT_FORWARD_NAMESPACE + SCHEMA_MODE_PORT_FORWARD_RESOURCE (CI), or SCHEMA_MODE_DB_HOST for a direct connection",
    );
  }

  const child = spawn(
    "oc",
    ["port-forward", "-n", ns!, resource!, `${localPort}:5432`],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  ) as ChildProcessWithoutNullStreams;

  const onOutput = (buf: Buffer) => {
    if (!process.env.DEBUG_SCHEMA_MODE_PF) {
      return;
    }
    console.log(`[schema-mode pf] ${buf.toString().trimEnd()}`);
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);

  child.on("error", (err) => {
    console.error("schema-mode port-forward spawn error:", err);
  });

  try {
    await waitForLocalPort(localPort, 45_000);
  } catch (e) {
    child.kill("SIGTERM");
    throw new Error(
      `${e instanceof Error ? e.message : String(e)}. Check oc login and resource ${resource} in ${ns}`,
    );
  }

  process.env.SCHEMA_MODE_DB_HOST = "localhost";

  return {
    stop: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  };
}
